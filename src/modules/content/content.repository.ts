import type postgres from "postgres";

export interface ContentPage { slug: string; title: string; content: string; versionNumber: number; publishedAt: Date; }

/** Persists immutable content versions and does not expose unpublished empty text publicly. */
export class ContentRepository {
  constructor(private readonly sql: postgres.Sql) {}
  async current(slug: string): Promise<ContentPage | null> { const rows=await this.sql<ContentPage[]>`select p.slug,p.title,v.content,v.version_number as "versionNumber",v.published_at as "publishedAt" from content_pages p join content_page_versions v on v.page_id=p.id and v.is_current=true where p.slug=${slug} and length(btrim(v.content))>0`;return rows[0]??null; }
  async publish(actorId:number,slug:string,title:string,content:string):Promise<ContentPage>{return this.sql.begin(async tx=>{const page=await tx<{id:number}[]>`select id from content_pages where slug=${slug} for update`;if(!page[0])throw new Error("PAGE_NOT_FOUND");await tx`update content_page_versions set is_current=false where page_id=${page[0].id} and is_current=true`;const rows=await tx<ContentPage[]>`insert into content_page_versions(page_id,version_number,content,is_current,created_by_user_id,created_at,published_at) select ${page[0].id},coalesce(max(version_number),0)+1,${content},true,${actorId},now(),now() from content_page_versions where page_id=${page[0].id} returning ${slug}::text as slug,${title}::text as title,content,version_number as "versionNumber",published_at as "publishedAt"`;await tx`update content_pages set title=${title},updated_at=now() where id=${page[0].id}`;await tx`insert into audit_logs(actor_user_id,action,entity_type,entity_id,new_values,created_at) values(${actorId},'content.published','content_page',${page[0].id},${JSON.stringify({slug})},now())`;return rows[0]!;}) as Promise<ContentPage>;}
}
