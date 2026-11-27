const key='burger-kiosk.account.v18';
let config=null,pendingRefresh;
export function configureAccountAuth(value){config=value;}
export function clearAccount(){sessionStorage.removeItem(key);}
export function hasAccount(){return Boolean(sessionStorage.getItem(key));}
export function rememberAccount(value){sessionStorage.setItem(key,JSON.stringify({idToken:value.idToken,refreshToken:value.refreshToken,expiresAt:Date.now()+Number(value.expiresIn)*1000}));}
function authError(code){
 const message=code==='EMAIL_EXISTS'?'이미 가입된 이메일입니다. 로그인 또는 비밀번호 찾기를 이용해 주세요.':code==='TOO_MANY_ATTEMPTS_TRY_LATER'?'요청이 많습니다. 잠시 후 다시 시도해 주세요.':code?.startsWith('WEAK_PASSWORD')?'비밀번호는 6자 이상으로 설정해 주세요.':code==='INVALID_EMAIL'?'이메일 주소를 확인해 주세요.':'이메일과 비밀번호를 확인해 주세요.';
 return new Error(message);
}
async function provider(action,body){
 if(!config?.enabled)throw new Error('이메일 로그인을 준비 중입니다.');
 let response,data;
 try{response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:'+action+'?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/json','X-Firebase-Locale':'ko'},body:JSON.stringify(body)});data=await response.json();}
 catch{throw new Error('인증 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');}
 if(!response.ok)throw Object.assign(authError(data.error?.message),{providerCode:data.error?.message});return data;
}
export async function signInEmail(email,password){return provider('signInWithPassword',{email:email.trim(),password,returnSecureToken:true});}
export async function registerEmail(email,password){
 if(password.length<6)throw new Error('비밀번호를 6자 이상으로 입력해 주세요.');
 const user=await provider('signUp',{email:email.trim(),password,returnSecureToken:true});
 await provider('sendOobCode',{requestType:'VERIFY_EMAIL',idToken:user.idToken});return user;
}
export async function sendVerification(email,password){const user=await signInEmail(email,password);await provider('sendOobCode',{requestType:'VERIFY_EMAIL',idToken:user.idToken});}
export async function sendPasswordReset(email){
 try{await provider('sendOobCode',{requestType:'PASSWORD_RESET',email:email.trim()});}
 catch(e){if(e.providerCode!=='EMAIL_NOT_FOUND')throw e;}
}
export async function accountToken(){
 let saved;try{saved=JSON.parse(sessionStorage.getItem(key));}catch{clearAccount();}if(!saved)return null;
 if(saved.expiresAt>Date.now()+60000)return saved.idToken;
 if(!pendingRefresh)pendingRefresh=(async()=>{
  if(!config?.enabled)throw Object.assign(new Error('다시 로그인해 주세요.'),{status:401});
  let r,data;try{r=await fetch('https://securetoken.googleapis.com/v1/token?key='+encodeURIComponent(config.apiKey),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:saved.refreshToken})});data=await r.json();}catch{throw new Error('인증 서버에 연결하지 못했습니다.');}
  if(!r.ok){clearAccount();throw Object.assign(new Error('다시 로그인해 주세요.'),{status:401});}
  rememberAccount({idToken:data.id_token,refreshToken:data.refresh_token,expiresIn:data.expires_in});return data.id_token;
 })().finally(()=>{pendingRefresh=null;});return pendingRefresh;
}
