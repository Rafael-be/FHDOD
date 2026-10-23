import type postgres from "postgres";
import type { Role } from "../auth/auth.repository.js";

export interface AdminUser { id: number; fullName: string; email: string; role: Role; deletedAt: Date | null; }
export interface Sector { id: number; code: string; name: string; deletedAt: Date | null; }
export interface SectorReadiness { hasShiftRanges: boolean; hasNps: boolean; }
export class AdminRepository {
  constructor(private readonly sql: postgres.Sql) {}
  async transaction<T>(work: (repository: AdminRepository) => Promise<T>): Promise<T> { return this.sql.begin(async (tx) => work(new AdminRepository(tx as unknown as postgres.Sql))) as Promise<T>; }
  async transactionWithConnection<T>(work: (repository: AdminRepository, connection: postgres.Sql) => Promise<T>): Promise<T> { return this.sql.begin(async (tx) => { const connection = tx as unknown as postgres.Sql; return work(new AdminRepository(connection), connection); }) as Promise<T>; }
  async manager(id: number, includeDeleted = false): Promise<AdminUser | null> { const rows = await this.sql<AdminUser[]>`select u.id,u.full_name as "fullName",u.email,r.code as role,u.deleted_at as "deletedAt" from users u join roles r on r.id=u.role_id where u.id=${id} ${includeDeleted ? this.sql`` : this.sql`and u.deleted_at is null`} and r.code='sector_manager'`; return rows[0] ?? null; }
  async managers(includeDeleted = false): Promise<AdminUser[]> { return this.sql<AdminUser[]>`select u.id,u.full_name as "fullName",u.email,r.code as role,u.deleted_at as "deletedAt" from users u join roles r on r.id=u.role_id where r.code='sector_manager' ${includeDeleted ? this.sql`` : this.sql`and u.deleted_at is null`} order by u.full_name`; }
  async createManager(fullName: string, email: string, passwordHash: string, expiresAt: Date): Promise<AdminUser> { const rows = await this.sql<AdminUser[]>`insert into users(role_id,full_name,email,password_hash,must_change_password,temporary_password_expires_at,created_at,updated_at) select id,${fullName},${email},${passwordHash},true,${expiresAt.toISOString()},now(),now() from roles where code='sector_manager' returning id,full_name as "fullName",email,'sector_manager'::text as role,deleted_at as "deletedAt"`; return rows[0]!; }
  async updateManager(id: number, fullName: string, email: string): Promise<AdminUser | null> { const rows = await this.sql<AdminUser[]>`update users set full_name=${fullName},email=${email},updated_at=now() where id=${id} and deleted_at is null returning id,full_name as "fullName",email,'sector_manager'::text as role,deleted_at as "deletedAt"`; return rows[0] ?? null; }
  /** Changes state only for a sector manager, never for another privileged account. */
  async deactivateManager(id: number): Promise<boolean> {
    const rows = await this.sql<{ id: number }[]>`
      update users u
      set deleted_at = now(), updated_at = now()
      from roles r
      where u.id = ${id}
        and u.role_id = r.id
        and r.code = 'sector_manager'
        and u.deleted_at is null
      returning u.id
    `;
    return rows.length === 1;
  }

  /** Reissues credentials only for a deactivated sector manager. */
  async reactivateManager(id: number, hash: string, expiresAt: Date): Promise<boolean> {
    const rows = await this.sql<{ id: number }[]>`
      update users u
      set deleted_at = null,
          password_hash = ${hash},
          must_change_password = true,
          temporary_password_expires_at = ${expiresAt.toISOString()},
          updated_at = now()
      from roles r
      where u.id = ${id}
        and u.role_id = r.id
        and r.code = 'sector_manager'
        and u.deleted_at is not null
      returning u.id
    `;
    return rows.length === 1;
  }
  async revokeSessions(userId: number): Promise<void> { await this.sql`update auth_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=${userId}`; }
  async sector(id: number, includeDeleted = false): Promise<Sector | null> { const rows=await this.sql<Sector[]>`select id,code,name,deleted_at as "deletedAt" from sectors where id=${id} ${includeDeleted ? this.sql`` : this.sql`and deleted_at is null`}`; return rows[0] ?? null; }
  async sectors(includeDeleted = false): Promise<Sector[]> { return this.sql<Sector[]>`select id,code,name,deleted_at as "deletedAt" from sectors where true ${includeDeleted ? this.sql`` : this.sql`and deleted_at is null`} order by name`; }
  async createSector(code: string,name: string,actor: number | null): Promise<Sector> { const rows=await this.sql<Sector[]>`insert into sectors(code,name,created_by_user_id,created_at,updated_at) values(${code},${name},${actor},now(),now()) returning id,code,name,deleted_at as "deletedAt"`; return rows[0]!; }
  async renameSector(id: number,name: string): Promise<Sector | null> { const rows=await this.sql<Sector[]>`update sectors set name=${name},updated_at=now() where id=${id} and deleted_at is null returning id,code,name,deleted_at as "deletedAt"`; return rows[0]??null; }
  async setSectorDeleted(id: number, deleted: boolean): Promise<boolean> { const rows=await this.sql<{id:number}[]>`update sectors set deleted_at=${deleted ? this.sql`now()` : null},updated_at=now() where id=${id} and deleted_at is ${deleted ? this.sql`null` : this.sql`not null`} returning id`; return rows.length===1; }
  /** Returns whether an active assignment was created instead of matching an existing one. */
  async assign(managerId: number, sectorId: number, actor: number): Promise<boolean> {
    const assignments = await this.sql<{ id: number }[]>`
      insert into user_sector_assignments (
        user_id,
        sector_id,
        assigned_at,
        assigned_by_user_id
      )
      values (${managerId}, ${sectorId}, now(), ${actor})
      on conflict (user_id, sector_id) where unassigned_at is null do nothing
      returning id
    `;

    return assignments.length === 1;
  }
  async unassign(managerId:number,sectorId:number,actor:number):Promise<boolean>{const r=await this.sql<{id:number}[]>`update user_sector_assignments set unassigned_at=now(),unassigned_by_user_id=${actor} where user_id=${managerId} and sector_id=${sectorId} and unassigned_at is null returning id`;return r.length===1;}
  async managerSectors(managerId:number):Promise<Sector[]>{return this.sql<Sector[]>`select s.id,s.code,s.name,s.deleted_at as "deletedAt" from sectors s join user_sector_assignments a on a.sector_id=s.id where a.user_id=${managerId} and a.unassigned_at is null and s.deleted_at is null order by s.name`;}
  /** Reads prerequisites from their authoritative tables; sector status is never stored. */
  async readiness(sectorId:number):Promise<SectorReadiness>{const rows=await this.sql<SectorReadiness[]>`select exists(select 1 from sector_shift_ranges r join shift_sheet_versions v on v.id=r.shift_sheet_version_id where r.sector_id=${sectorId} and v.is_current=true) as "hasShiftRanges", exists(select 1 from sector_nps_assignments n where n.sector_id=${sectorId} and n.ended_at is null) as "hasNps"`;return rows[0]!;}
  async audit(actor:number,action:string,entity:string,id:number,oldValues:object|null,newValues:object|null):Promise<void>{await this.sql`insert into audit_logs(actor_user_id,action,entity_type,entity_id,old_values,new_values,created_at) values(${actor},${action},${entity},${id},${oldValues === null ? null : JSON.stringify(oldValues)},${newValues === null ? null : JSON.stringify(newValues)},now())`;}
}
