import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
import { createHandler } from './handler.mjs';
import { createMcpHandler, resourceMetadata } from './mcp.mjs';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const handler=createHandler(db,undefined,name=>Deno.env.get(name));
const mcp=createMcpHandler(handler);
Deno.serve(req=>{const path=new URL(req.url).pathname;if(path.endsWith('/.well-known/oauth-protected-resource'))return Response.json(resourceMetadata,{headers:{'cache-control':'public, max-age=300','access-control-allow-origin':'*'}});return path.endsWith('/mcp')?mcp(req):handler(req);});
