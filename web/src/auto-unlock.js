// Observe only this login field. No persistent storage, logging, or credential APIs.
export function watchAutoUnlock(input, canSubmit, { delay = 750, interval = 120 } = {}) {
  const form = input.form;
  let observed = '', attempted = '', changedAt = Date.now(), manual = false, stopped = false;
  let lastKey = -Infinity;
  const remember = (isManual) => {
    observed = input.value;
    changedAt = Date.now();
    manual = isManual;
  };
  const autofilled = () => {
    for (const selector of [':autofill', ':-webkit-autofill']) {
      try { if (input.matches(selector)) return true; } catch { /* Unsupported selector. */ }
    }
    return false;
  };
  const keydown = (event) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey &&
        (event.key.length === 1 || ['Backspace','Delete','Process','Unidentified'].includes(event.key))) {
      lastKey = Date.now();
      remember(true);
    }
  };
  const edited = (event) => {
    const replacement = ['insertFromPaste','insertReplacementText','insertFromDrop'].includes(event.inputType);
    const typing = event.isTrusted && !replacement && !autofilled() &&
      (Date.now()-lastKey < 500 || event.isComposing ||
       (event.inputType || '').startsWith('delete') ||
       (event.inputType === 'insertText' &&
        (event.data?.length === 1 || (!event.data && Math.abs(input.value.length-observed.length) <= 1))));
    remember(Boolean(typing));
  };
  const submitted = () => { attempted = input.value; };
  const check = () => {
    if (stopped || !input.isConnected) return;
    // Some password managers set value without dispatching input/change events.
    if (input.value !== observed) remember(false);
    if (!manual && observed && observed !== attempted && Date.now()-changedAt >= delay &&
        canSubmit() && input.checkValidity()) {
      attempted = observed;
      form.requestSubmit();
    }
  };
  input.addEventListener('keydown',keydown);
  input.addEventListener('input',edited);
  input.addEventListener('change',edited);
  form.addEventListener('submit',submitted);
  check();
  const timer = setInterval(check,interval);
  return () => {
    stopped = true;clearInterval(timer);
    input.removeEventListener('keydown',keydown);
    input.removeEventListener('input',edited);
    input.removeEventListener('change',edited);
    form.removeEventListener('submit',submitted);
    observed = '';attempted = '';
  };
}
