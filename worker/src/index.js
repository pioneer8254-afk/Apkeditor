import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type"}});
const cors={ "access-control-allow-origin":"*", "access-control-allow-methods":"GET,POST,OPTIONS", "access-control-allow-headers":"content-type" };
function randomId(){return crypto.randomUUID().replace(/-/g,"");}
function s3(env){return new S3Client({region:"auto",endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}});}
async function github(env,path,init={}){const r=await fetch("https://api.github.com"+path,{...init,headers:{"Authorization":"Bearer "+env.GITHUB_TOKEN,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"APK-Editor-Builder",...(init.headers||{})}});if(!r.ok)throw new Error("GitHub API: "+r.status+" "+(await r.text()).slice(0,300));return r.status===204?null:r.json();}
export default {
 async fetch(request,env){
  if(request.method==="OPTIONS")return new Response(null,{headers:cors});
  const url=new URL(request.url);
  try{
   if(url.pathname==="/api/build"&&request.method==="POST"){
    const form=await request.formData();const project=form.get("project");
    if(!(project instanceof File))return json({error:"فایل پروژه ارسال نشده است."},400);
    if(project.size>25*1024*1024)return json({error:"حداکثر حجم فایل پروژه ۲۵ مگابایت است."},413);
    const appName=String(form.get("appName")||"My Web App").slice(0,40);
    const packageId=String(form.get("packageId")||"");
    if(!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageId)||packageId.length>180)return json({error:"شناسه برنامه معتبر نیست."},400);
    const id=randomId(), callbackSecret=randomId(), key="sources/"+id+".zip";
    await s3(env).send(new PutObjectCommand({Bucket:env.R2_BUCKET,Key:key,Body:await project.arrayBuffer(),ContentType:"application/zip"}));
    const sourceUrl=await getSignedUrl(s3(env),new GetObjectCommand({Bucket:env.R2_BUCKET,Key:key}),{expiresIn:3600});
    const callbackUrl=new URL("/api/callback",url.origin).toString();
    await env.BUILDS.put(id,JSON.stringify({status:"queued",createdAt:Date.now(),callbackSecret,sourceKey:key,appName,packageId}),{expirationTtl:86400});
    try{
     await github(env,`/repos/${env.GITHUB_REPOSITORY}/actions/workflows/build-user-apk.yml/dispatches`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ref:env.GITHUB_BRANCH||"main",inputs:{build_id:id,source_url:sourceUrl,callback_url:callbackUrl,callback_secret:callbackSecret}})});
    }catch(e){await s3(env).send(new DeleteObjectCommand({Bucket:env.R2_BUCKET,Key:key}));await env.BUILDS.put(id,JSON.stringify({status:"failed",error:"ارسال درخواست به GitHub Actions ناموفق بود: "+e.message}),{expirationTtl:86400});return json({error:"سرویس ساخت نتوانست اجرای کامپایل را آغاز کند. تنظیمات GitHub را بررسی کنید."},502);}
    return json({buildId:id,status:"queued"},202);
   }
   if(url.pathname==="/api/callback"&&request.method==="POST"){
    const body=await request.json();const current=await env.BUILDS.get(body.build_id);
    if(!current)return json({error:"ساخت پیدا نشد."},404);
    const item=JSON.parse(current);
    if(!body.secret||body.secret!==item.callbackSecret)return json({error:"دسترسی غیرمجاز."},401);
    item.status=body.status==="completed"?"completed":"failed";item.runId=Number(body.run_id)||null;item.error=String(body.error||"").slice(0,1000);item.completedAt=Date.now();
    await env.BUILDS.put(body.build_id,JSON.stringify(item),{expirationTtl:86400});
    return json({ok:true});
   }
   const match=url.pathname.match(/^\/api\/build\/([a-f0-9]{32})(\/download)?$/);
   if(match&&request.method==="GET"){
    const id=match[1],itemRaw=await env.BUILDS.get(id);if(!itemRaw)return json({error:"درخواست ساخت پیدا نشد یا منقضی شده است."},404);
    const item=JSON.parse(itemRaw);
    if(match[2]){
     if(item.status!=="completed"||!item.runId)return json({error:"فایل هنوز آماده نیست."},409);
     const data=await github(env,`/repos/${env.GITHUB_REPOSITORY}/actions/runs/${item.runId}/artifacts`);
     const artifact=data.artifacts?.find(x=>x.name==="apk-output"&&!x.expired);
     if(!artifact)return json({error:"فایل خروجی در GitHub Actions پیدا نشد."},404);
     const r=await fetch(artifact.archive_download_url,{headers:{"Authorization":"Bearer "+env.GITHUB_TOKEN,"Accept":"application/vnd.github+json"}});
     if(!r.ok)return json({error:"دریافت فایل خروجی از سرور ناموفق بود."},502);
     return new Response(r.body,{headers:{...cors,"content-type":"application/zip","content-disposition":'attachment; filename="apk-output.zip"',"cache-control":"no-store"}});
    }
    return json({status:item.status,error:item.error||null});
   }
   return json({error:"مسیر پیدا نشد."},404);
  }catch(e){return json({error:e.message||"خطای داخلی سرویس ساخت."},500);}
 }
};