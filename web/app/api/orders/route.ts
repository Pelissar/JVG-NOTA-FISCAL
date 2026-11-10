import { getJvgUser } from "../../jvg-auth";
import { apiJson, dbRequest, filterEq, getSiteAccount, isSameOrigin, JvgBackendError, safeError } from "../../../lib/jvg-backend";
export const dynamic = "force-dynamic";
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function account(){
 const user=await getJvgUser();
 if(!user)throw new JvgBackendError("Faça login para continuar.",401);
 const scope=await getSiteAccount(user);
 if(!scope)throw new JvgBackendError("Cadastre sua empresa primeiro.",409);
 return scope;
}
export async function GET(request:Request){
 try{
  const scope=await account();
  const raw=new URL(request.url).searchParams.get("page")??"1";
  if(!/^[1-9]\d{0,4}$/.test(raw))throw new JvgBackendError("Página inválida.",400);
  const page=Number(raw),size=30;
  const status=new URL(request.url).searchParams.get("status")??"";
  if(status&&!['open','fulfilled','cancelled'].includes(status))throw new JvgBackendError("Situação de pedido inválida.",400);
  const orders=await dbRequest<Array<Record<string,unknown>>>(
   `/rest/v1/jvg_orders?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}${status?`&status=${filterEq(status)}`:""}&select=id,quote_id,customer_id,status,total,items,notes,created_at&order=created_at.desc,id.desc&limit=${size+1}&offset=${(page-1)*size}`
  );
  const pageOrders=orders.slice(0,size);
  const quoteIds=[...new Set(pageOrders.map(order=>String(order.quote_id)).filter(id=>uuidPattern.test(id)))];
  let quoteNumberById=new Map<string,unknown>();
  if(quoteIds.length){
   try{
    const quotes=await dbRequest<Array<{id:string;quote_number:number|string}>>(
     `/rest/v1/jvg_quotes?tenant_id=${filterEq(scope.tenant_id)}&company_id=${filterEq(scope.company_id)}&id=in.(${quoteIds.join(",")})&select=id,quote_number`
    );
    quoteNumberById=new Map(quotes.map(quote=>[quote.id,quote.quote_number]));
   }catch{/* Numeração estará disponível depois da migração. */}
  }
  return apiJson({orders:pageOrders.map(order=>({...order,quote_number:quoteNumberById.get(String(order.quote_id))??null})),page,hasMore:orders.length>size});
 }catch(error){return safeError(error);}
}

export async function POST(request:Request){
 if(!isSameOrigin(request))return apiJson({error:"Origem não autorizada."},403);
 try{
  const scope=await account();
  if(scope.role==="viewer")throw new JvgBackendError("Sem permissão para criar pedidos.",403);
  const input:unknown=await request.json();
  if(!input||typeof input!=="object"||Array.isArray(input))throw new JvgBackendError("Pedido inválido.",400);
  const quoteId=(input as Record<string,unknown>).quoteId;
  if(typeof quoteId!=="string"||!uuidPattern.test(quoteId))throw new JvgBackendError("Orçamento inválido.",400);
  const orderId=await dbRequest<string>("/rest/v1/rpc/jvg_create_order_from_quote",{
   method:"POST",
   body:JSON.stringify({p_tenant_id:scope.tenant_id,p_company_id:scope.company_id,p_quote_id:quoteId})
  });
  if(!orderId)throw new JvgBackendError("Não foi possível criar o pedido.",409);
  return apiJson({ok:true,orderId},201);
 }catch(error){return safeError(error);}
}

/** Cancelamento condicionado ao estado aberto; pedido cancelado não gera movimentação de estoque. */
/** Cancela o pedido e sua proposta de origem na mesma transação. */
export async function PATCH(request:Request){
 if(!isSameOrigin(request))return apiJson({error:"Origem não autorizada."},403);
 try{
  const scope=await account();
  if(scope.role==="viewer")throw new JvgBackendError("Sem permissão para cancelar pedidos.",403);
  const input:unknown=await request.json();
  if(!input||typeof input!=="object"||Array.isArray(input))throw new JvgBackendError("Pedido inválido.",400);
  const data=input as Record<string,unknown>;
  if(typeof data.id!=="string"||!uuidPattern.test(data.id))throw new JvgBackendError("Pedido inválido.",400);
  if(data.status!=="cancelled")throw new JvgBackendError("Alteração não permitida.",400);
  const cancelled=await dbRequest<boolean>("/rest/v1/rpc/jvg_cancel_order",{
   method:"POST",
   body:JSON.stringify({p_tenant_id:scope.tenant_id,p_company_id:scope.company_id,p_order_id:data.id})
  });
  if(cancelled!==true)throw new JvgBackendError("Pedido não encontrado ou já alterado. Atualize a lista.",409);
  return apiJson({ok:true,order:{id:data.id,status:"cancelled"},quote:{status:"cancelled"}});
 }catch(error){return safeError(error);}
}
