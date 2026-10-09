(function () {
  'use strict';
  const generate = document.getElementById('handoffGenerate');
  const copy = document.getElementById('handoffCopy');
  const output = document.getElementById('handoffOutput');
  if (!generate || !copy || !output) return;
  let verified = false;
  const lock = () => {
    verified = false;
    generate.disabled = true;
    copy.disabled = true;
    output.textContent = 'Authenticated PCC workforce runtime verification required.';
  };
  lock();
  window.addEventListener('pcc:systems-runtime-verified', event => {
    if (event.detail?.actor_id !== 'RPE-MASON-HQ') return;
    verified = true;
    generate.disabled = false;
  });
  document.getElementById('systemsSignOut')?.addEventListener('click', lock);
  document.getElementById('systemsSignIn')?.addEventListener('click', lock);
  generate.addEventListener('click', event => {
    if (!verified) { event.stopImmediatePropagation(); lock(); }
  }, true);
  copy.addEventListener('click', event => {
    if (!verified) { event.stopImmediatePropagation(); lock(); }
  }, true);
})();
