import { HealthService } from "../../src/modules/health/health.service.js";
describe("HealthService",()=>{
  it("reports liveness and database readiness",async()=>{const service=new HealthService({isAvailable:async()=>true});expect(service.live()).toEqual({status:"ok"});await expect(service.ready()).resolves.toEqual({status:"ok"});});
  it("maps database probe failures without infrastructure details",async()=>{const service=new HealthService({isAvailable:async()=>{throw new Error("private connection information");}});await expect(service.ready()).rejects.toMatchObject({code:"SERVICE_UNAVAILABLE",status:503,message:"Serviço temporariamente indisponível."});});
});
