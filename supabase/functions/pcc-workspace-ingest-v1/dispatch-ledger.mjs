const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateDispatchAttempt(input={}){
 const intake_id=typeof input.intake_id==="string"?input.intake_id.trim():"";
 const dispatch_action_id=typeof input.dispatch_action_id==="string"?input.dispatch_action_id.trim():"";
 if(!UUID.test(intake_id))throw new Error("INVALID_INTAKE_ID");
 if(!UUID.test(dispatch_action_id))throw new Error("INVALID_DISPATCH_ACTION_ID");
 return {intake_id,dispatch_action_id};
}
