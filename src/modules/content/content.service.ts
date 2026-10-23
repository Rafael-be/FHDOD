import { DomainError, notFound } from "../../shared/core.js";
import type { AuthIdentity } from "../auth/auth.service.js";
import { ContentRepository } from "./content.repository.js";

/** Enforces publication and superuser-only content versioning. */
export class ContentService {
  constructor(private readonly repository: ContentRepository) {}
  async getPublished(slug:string){const page=await this.repository.current(slug);if(!page)throw notFound("Conteúdo indisponível.");return page;}
  async publish(actor:AuthIdentity,slug:string,title:string,content:string){if(actor.role!=="superuser")throw new DomainError("FORBIDDEN","Somente superusuário pode publicar conteúdo.",403);try{return await this.repository.publish(actor.userId,slug,title.trim(),content.trim());}catch(error){if((error as Error).message==="PAGE_NOT_FOUND")throw notFound("Página não encontrada.");throw error;}}
}
