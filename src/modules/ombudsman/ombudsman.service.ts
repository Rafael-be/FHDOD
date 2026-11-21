import type { Clock } from "../../shared/core.js";
import type { AuthIdentity } from "../auth/auth.service.js";
import { DomainError } from "../../shared/core.js";
import { OmbudsmanRepository, type TicketFilters, type TicketInput, type TicketStatus } from "./ombudsman.repository.js";

export class OmbudsmanService {
  constructor(private readonly repository: OmbudsmanRepository, private readonly clock: Clock) {}
  create(input:TicketInput) { return this.repository.create(input,this.clock.now()); }
  private authorize(actor:AuthIdentity) { if(actor.role!=="superuser") throw new DomainError("FORBIDDEN","Acesso à Ouvidoria não permitido.",403); }
  list(actor:AuthIdentity,filters:TicketFilters) { this.authorize(actor); return this.repository.list(filters); }
  async get(actor:AuthIdentity,id:number) { this.authorize(actor); const ticket=await this.repository.get(id); if(!ticket) throw new DomainError("TICKET_NOT_FOUND","Manifestação não encontrada.",404); return ticket; }
  updateStatus(actor:AuthIdentity,id:number,status:TicketStatus) { this.authorize(actor); return this.repository.updateStatus(id,status,actor.userId); }
}
