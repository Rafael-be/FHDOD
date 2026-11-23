import request from "supertest";
import { jest } from "@jest/globals";
import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import type { AuthService } from "../../src/modules/auth/auth.service.js";
import { OmbudsmanService } from "../../src/modules/ombudsman/ombudsman.service.js";
import type { AdminService } from "../../src/modules/admin/admin.service.js";
import type { OmbudsmanRepository } from "../../src/modules/ombudsman/ombudsman.repository.js";

const config:AppConfig={NODE_ENV:"test",PORT:3000,DATABASE_URL:"postgres://unused:unused@localhost/unused",ALLOWED_ORIGIN:"http://localhost:5173",JWT_SECRET:"12345678901234567890123456789012",JWT_ISSUER:"fhdod-api",JWT_AUDIENCE:"fhdod-web",PERFORMANCE_MEASUREMENTS:false};
function fixture(role:"superuser"|"sector_manager"="superuser") {
  const create=jest.fn(async()=>({id:42,status:"open"}));
  const list=jest.fn(async()=>({items:[{id:42,status:"open",createdAt:"2026-11-21T12:00:00.000Z"}],page:1,pageSize:20,total:1}));
  const get=jest.fn(async()=>({id:42,status:"open",createdAt:"2026-11-21T12:00:00.000Z"}));
  const updateStatus=jest.fn(async()=>({id:42,status:"resolved"}));
  const repo={create,list,get,updateStatus} as unknown as OmbudsmanRepository;
  const auth={authenticate:async()=>({userId:7,sessionId:"session",role,mustChangePassword:false}),recoverCsrfForIdentity:async()=>"csrf"} as unknown as AuthService;
  const service=new OmbudsmanService(repo,{now:()=>new Date("2026-11-21T12:00:00.000Z")});
  return {app:createApp(config,{authService:auth,adminService:{} as AdminService,ombudsmanService:service}),create,list,updateStatus};
}
describe("ombudsman HTTP contract",()=>{
  it("validates public input, consent and returns only the ticket reference",async()=>{
    const {app,create}=fixture();
    await request(app).post("/api/public/ombudsman/tickets").send({sectorId:3,ticketType:"complaint",body:"Atendimento",policyAccepted:false}).expect(400);
    await request(app).post("/api/public/ombudsman/tickets").send({sectorId:3,ticketType:"unknown",body:"Atendimento",policyAccepted:true}).expect(400);
    expect(create).not.toHaveBeenCalled();
    const response=await request(app).post("/api/public/ombudsman/tickets").send({sectorId:3,ticketType:"complaint",body:"Atendimento",policyAccepted:true}).expect(201);
    expect(response.body).toEqual({data:{id:42,status:"open"}});
    expect(create).toHaveBeenCalledWith(expect.objectContaining({sectorId:3,ticketType:"complaint",body:"Atendimento"}),expect.any(Date));
    for (const phone of [null, "", "(51) 99999-9999", "(51) 3333-4444"]) {
      await request(app).post("/api/public/ombudsman/tickets").send({sectorId:3,ticketType:"complaint",body:"Atendimento",phone,policyAccepted:true}).expect(201);
    }
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({phone:"5133334444"}),expect.any(Date));
    await request(app).post("/api/public/ombudsman/tickets").send({sectorId:3,ticketType:"complaint",body:"Atendimento",phone:"(51) 99999-9999 ramal",policyAccepted:true}).expect(400);
    expect(create).toHaveBeenCalledTimes(5);
  });
  it("protects list and status change with role and CSRF",async()=>{
    const admin=fixture();
    await request(admin.app).get("/api/ombudsman/tickets").expect(401);
    await request(admin.app).patch("/api/ombudsman/tickets/42/status").set("Cookie","access_token=x").send({status:"resolved"}).expect(403);
    expect(admin.updateStatus).not.toHaveBeenCalled();
    const manager=fixture("sector_manager");
    await request(manager.app).get("/api/ombudsman/tickets").set("Cookie","access_token=x").expect(403);
    await request(manager.app).patch("/api/ombudsman/tickets/42/status").set("Cookie","access_token=x").set("x-csrf-token","csrf").send({status:"resolved"}).expect(403);
    const listed=await request(admin.app).get("/api/ombudsman/tickets?page=1").set("Cookie","access_token=x").expect(200);
    expect(listed.body.data.total).toBe(1);
    expect(listed.body.data.items[0]).toMatchObject({id:42,status:"open",createdAt:"2026-11-21T12:00:00.000Z"});
    const detail=await request(admin.app).get("/api/ombudsman/tickets/42").set("Cookie","access_token=x").expect(200);
    expect(detail.body.data.createdAt).toBe("2026-11-21T12:00:00.000Z");
    const changed=await request(admin.app).patch("/api/ombudsman/tickets/42/status").set("Cookie","access_token=x").set("x-csrf-token","csrf").send({status:"resolved"}).expect(200);
    expect(changed.body.data.status).toBe("resolved");
    expect(admin.updateStatus).toHaveBeenCalledWith(42,"resolved",7);
  });
});
