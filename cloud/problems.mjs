export class Problem extends Error {
  constructor(message,status=400,code='INVALID_INPUT'){super(message);this.status=status;this.code=code;}
}
export function check(condition,message,status=400,code='INVALID_INPUT'){
  if(!condition)throw new Problem(message,status,code);
}
