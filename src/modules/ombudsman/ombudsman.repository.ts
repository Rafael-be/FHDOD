import type postgres from "postgres";
import { DomainError } from "../../shared/core.js";
import { hospitalShiftTime } from "../submissions/submission-time.js";

export const ticketTypes = ["complaint", "compliment", "suggestion_other"] as const;
export const ticketStatuses = ["open", "read", "contact_attempt", "contact_failed", "resolved"] as const;
export type TicketType = typeof ticketTypes[number];
export type TicketStatus = typeof ticketStatuses[number];
export interface TicketInput { sectorId: number; ticketType: TicketType; body: string; phone?: string; acceptedPolicyVersionId?: number; }
export interface TicketFilters { sectorId?: number; ticketType?: TicketType; status?: TicketStatus; from?: string; to?: string; page: number; pageSize: number; }

export function canTransitionTicket(from: string, to: TicketStatus, hasPhone: boolean): boolean {
  if ((to === "contact_attempt" || to === "contact_failed") && !hasPhone) return false;
  const allowed: Record<string, readonly TicketStatus[]> = {
    open: ["read", "contact_attempt", "resolved"],
    read: ["contact_attempt", "resolved"],
    contact_attempt: ["contact_failed", "resolved"],
    contact_failed: ["contact_attempt", "resolved"],
  };
  return allowed[from]?.includes(to) ?? false;
}

export class OmbudsmanRepository {
  constructor(private readonly sql: postgres.Sql) {}
  async create(input: TicketInput, now: Date): Promise<{ id: number; status: TicketStatus }> {
    return this.sql.begin(async (tx) => {
      const sector = await tx`select id from sectors where id=${input.sectorId} and deleted_at is null`;
      if (!sector.length) throw new DomainError("SECTOR_NOT_FOUND", "Setor inexistente ou inativo.", 404);
      const policy = await tx<{id:number}[]>`select v.id from content_page_versions v join content_pages p on p.id=v.page_id where p.slug='lgpd' and v.is_current=true and length(btrim(v.content))>0`;
      if (!policy[0] || (input.acceptedPolicyVersionId !== undefined && input.acceptedPolicyVersionId !== policy[0].id)) throw new DomainError("POLICY_VERSION_INVALID", "Versão vigente da política inválida.", 400);
      const time = hospitalShiftTime(now);
      const matches = await tx<{ id: number; versionId: number }[]>`
        select distinct r.id, v.id as "versionId" from shift_sheet_versions v
        join sector_shift_ranges r on r.shift_sheet_version_id=v.id and r.sector_id=${input.sectorId}
        left join employee_shift_assignments a on a.shift_sheet_version_id=v.id and a.sector_id=r.sector_id and a.shift_range_id=r.id
        where v.is_current=true and (
          (r.ends_at>r.starts_at and coalesce(r.day_of_week,a.day_of_week)=${time.dayOfWeek} and ${time.localTime}::time>=r.starts_at and ${time.localTime}::time<r.ends_at)
          or (r.ends_at<r.starts_at and ((coalesce(r.day_of_week,a.day_of_week)=${time.dayOfWeek} and ${time.localTime}::time>=r.starts_at)
            or (coalesce(r.day_of_week,a.day_of_week)=${time.previousDayOfWeek} and ${time.localTime}::time<r.ends_at)))
        )`;
      if (matches.length>1) throw new DomainError("SHIFT_AMBIGUOUS", "Há mais de um turno vigente para o horário informado.", 409);
      // A ticket may be created outside an active shift. In that case do not
      // invent a version from another sector; both shift references remain null.
      const version = matches[0]?.versionId ?? null;
      const rows = await tx<{ id: number; status: TicketStatus }[]>`
        insert into ombudsman_tickets (sector_id,shift_sheet_version_id,shift_range_id,occurred_at,ticket_type,body,phone_normalized,accepted_policy_version_id,policy_accepted_at,created_at,updated_at)
        values (${input.sectorId},${version},${matches[0]?.id ?? null},${now.toISOString()},${input.ticketType},${input.body},${input.phone ?? null},${policy[0].id},${now.toISOString()},${now.toISOString()},${now.toISOString()})
        returning id,status`;
      return rows[0]!;
    }) as Promise<{ id: number; status: TicketStatus }>;
  }
  async list(filters: TicketFilters) {
    const offset=(filters.page-1)*filters.pageSize;
    const criteria=this.sql`where (${filters.sectorId ?? null}::integer is null or sector_id=${filters.sectorId ?? null}) and (${filters.ticketType ?? null}::ombudsman_ticket_type is null or ticket_type=${filters.ticketType ?? null}) and (${filters.status ?? null}::ombudsman_ticket_status is null or status=${filters.status ?? null}) and (${filters.from ?? null}::timestamptz is null or created_at>=${filters.from ?? null}::timestamptz) and (${filters.to ?? null}::timestamptz is null or created_at<=${filters.to ?? null}::timestamptz)`;
    const items=await this.sql`select id,sector_id as "sectorId",shift_sheet_version_id as "shiftSheetVersionId",shift_range_id as "shiftRangeId",occurred_at as "occurredAt",ticket_type as "ticketType",status,body,phone_normalized as phone,created_at as "createdAt",updated_at as "updatedAt" from ombudsman_tickets ${criteria} order by created_at desc,id desc limit ${filters.pageSize} offset ${offset}`;
    const count=await this.sql<{ total: number }[]>`select count(*)::int as total from ombudsman_tickets ${criteria}`;
    return { items,page:filters.page,pageSize:filters.pageSize,total:count[0]!.total };
  }
  async get(id:number) { return (await this.sql`select id,sector_id as "sectorId",shift_sheet_version_id as "shiftSheetVersionId",shift_range_id as "shiftRangeId",occurred_at as "occurredAt",ticket_type as "ticketType",status,body,phone_normalized as phone,accepted_policy_version_id as "acceptedPolicyVersionId",policy_accepted_at as "policyAcceptedAt",created_at as "createdAt",updated_at as "updatedAt" from ombudsman_tickets where id=${id}`)[0] ?? null; }
  async updateStatus(id:number,status:TicketStatus,actorId:number) {
    return this.sql.begin(async tx => {
      const previous=(await tx<{status:string;phone:string|null}[]>`select status,phone_normalized as phone from ombudsman_tickets where id=${id} for update`)[0];
      if (!previous) throw new DomainError("TICKET_NOT_FOUND","Manifestação não encontrada.",404);
      if (previous.status===status) throw new DomainError("STATUS_UNCHANGED","A manifestação já possui esse status.",409);
      if (!canTransitionTicket(previous.status,status,Boolean(previous.phone))) throw new DomainError("INVALID_TICKET_STATUS_TRANSITION","Transição de status inválida para esta manifestação.",409);
      const updated=(await tx`update ombudsman_tickets set status=${status},updated_at=now() where id=${id} returning id,status,updated_at as "updatedAt"`)[0];
      await tx`insert into audit_logs(actor_user_id,action,entity_type,entity_id,old_values,new_values,created_at) values (${actorId},'ombudsman.status_updated','ombudsman_ticket',${id},${JSON.stringify({status:previous.status})},${JSON.stringify({status})},now())`;
      return updated;
    });
  }
}
