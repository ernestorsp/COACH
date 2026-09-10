(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  for(let i=0;i<50&&!document.getElementById('inviteModal');i++) await wait(100);
  const modal=document.getElementById('inviteModal');
  const btn=document.getElementById('sendInviteBtn');
  if(!modal||!btn)return;

  const title=modal.querySelector('h3'); if(title) title.textContent='Create user';
  const usersHelp=document.querySelector('#users .muted'); if(usersHelp) usersHelp.textContent='Create users with their email, password and access role.';
  const openBtn=document.getElementById('inviteUserBtn'); if(openBtn) openBtn.textContent='+ Create user';
  const warn=modal.querySelector('.warnbox');
  if(warn) warn.outerHTML='<div class="field"><label>Password</label><input id="createUserPassword" type="password" autocomplete="new-password" placeholder="Minimum 8 characters"></div><div class="field"><label>Confirm password</label><input id="createUserPassword2" type="password" autocomplete="new-password" placeholder="Repeat password"></div><div class="warnbox">The user will sign in directly with this email and password. Creating the same email again will update that account and its password.</div>';
  btn.textContent='Create user';

  const {getAuth}=await import('https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js');
  const auth=getAuth();
  const url='https://us-east1-coachaaxi.cloudfunctions.net/adminUser';
  const show=t=>{const e=document.getElementById('toast');if(!e)return;e.textContent=t;e.classList.add('on');setTimeout(()=>e.classList.remove('on'),2800)};

  btn.addEventListener('click',async ev=>{
    ev.preventDefault();ev.stopImmediatePropagation();
    const name=document.getElementById('inviteName').value.trim();
    const email=document.getElementById('inviteEmail').value.trim();
    const role=document.getElementById('inviteRole').value;
    const password=document.getElementById('createUserPassword')?.value||'';
    const confirm=document.getElementById('createUserPassword2')?.value||'';
    if(!email)return show('Enter an email.');
    if(password.length<8)return show('Password must have at least 8 characters.');
    if(password!==confirm)return show('Passwords do not match.');
    btn.disabled=true;
    try{
      const token=await auth.currentUser.getIdToken(true);
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({action:'create',name,email,role,password})});
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);
      modal.classList.remove('on');
      document.getElementById('inviteName').value='';document.getElementById('inviteEmail').value='';document.getElementById('inviteRole').value='user';document.getElementById('createUserPassword').value='';document.getElementById('createUserPassword2').value='';
      show(data.reused?'User updated and password changed.':'User created successfully.');
      setTimeout(()=>location.reload(),700);
    }catch(e){show(e.message||'Could not create user.')}finally{btn.disabled=false}
  },true);
})();
