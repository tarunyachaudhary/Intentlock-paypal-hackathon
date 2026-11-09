import { useEffect, useState, useCallback } from 'react';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { api, session } from './api.js';

const usd = (n) => `$${Number(n).toFixed(2)}`;
const EXAMPLES = [
  'Buy a wireless keyboard under $100. Only from trusted sellers. Ask me before paying.',
  'Headphones, budget $90, only from SoundWorks.',
];

function AuthForm({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api[mode](email, password); session.set(r.token); onAuth(r.email); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="panel auth" onSubmit={submit}>
      <h2>{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {err && <p className="error" role="alert">{err}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>
    </form>
  );
}

function Mandate({ policy, onSave }) {
  const [text, setText] = useState(EXAMPLES[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { await onSave(text); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <section className="panel">
      <h2>1. Tell your agent what it may buy</h2>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="Purchase instruction" />
      <div className="chips">{EXAMPLES.map((x) => <button key={x} className="chip" onClick={() => setText(x)}>{x.slice(0, 34)}…</button>)}</div>
      {err && <p className="error" role="alert">{err}</p>}
      <button className="primary" onClick={save} disabled={busy || text.length < 5}>{busy ? 'Reading your instruction…' : 'Set spending permissions'}</button>
      {policy && (
        <dl className="policy">
          <div><dt>Category</dt><dd>{policy.category || 'any'}</dd></div>
          <div><dt>Budget</dt><dd>{usd(policy.maxBudget)} {policy.currency}</dd></div>
          <div><dt>Sellers</dt><dd>{policy.allowedMerchants?.length ? policy.allowedMerchants.join(', ') : 'any verified'}</dd></div>
          <div><dt>Approval</dt><dd>Always required</dd></div>
          <div><dt>Read by</dt><dd>{policy.parsedBy === 'llm' ? 'AI model' : 'rule-based parser'}</dd></div>
        </dl>
      )}
    </section>
  );
}

function Shelf({ products, disabled, onPropose, busyId }) {
  return (
    <section className="panel">
      <h2>2. The agent found these. Let it propose one.</h2>
      <ul className="shelf">
        {products.map((p) => (
          <li key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <span className="muted">{p.merchant.name}{p.merchant.verified ? '' : ' · unverified'} · {p.category}</span>
            </div>
            <span className="price">{usd(p.price)}</span>
            <button onClick={() => onPropose(p.id)} disabled={disabled || busyId === p.id}>{busyId === p.id ? 'Checking…' : 'Propose'}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Decision({ purchase, onApprove, onReject, onPaid, onBump, onDrift }) {
  const [phase, setPhase] = useState('review');
  const [err, setErr] = useState('');
  useEffect(() => { setPhase(purchase.status === 'APPROVED' ? 'pay' : purchase.status === 'CAPTURED' ? 'done' : 'review'); setErr(''); }, [purchase._id, purchase.status]);

  const blocked = purchase.status === 'BLOCKED';
  const approve = async () => { try { await onApprove(purchase._id); setPhase('pay'); } catch (x) { setErr(x.message); } };

  return (
    <section className={`panel decision ${blocked ? 'is-blocked' : purchase.status === 'CAPTURED' ? 'is-done' : 'is-allowed'}`}>
      <div className="stamp" aria-live="polite">{blocked ? 'Blocked' : purchase.status === 'CAPTURED' ? 'Paid' : 'Eligible'}</div>
      <h2>3. {purchase.productSnapshot.name}</h2>
      <p className="lead">{purchase.explanation}</p>

      <ul className="checks">
        {purchase.checks.map((c) => (
          <li key={c.code} className={c.passed ? 'pass' : 'fail'}>
            <span aria-hidden="true">{c.passed ? '✓' : '✕'}</span>
            <span><span className="sr">{c.passed ? 'Passed: ' : 'Failed: '}</span>{c.detail}</span>
          </li>
        ))}
      </ul>

      <p className="risk">
        Risk score <strong>{purchase.risk.score}/100 ({purchase.risk.level.toLowerCase()})</strong>
        {purchase.risk.signals.length > 0 && <> · {purchase.risk.signals.map((s) => s.detail).join(' ')}</>}
        <span className="muted"> Heuristic only. Not fraud detection.</span>
      </p>

      {blocked && <p className="note">No PayPal order was created. The agent cannot pay for this.</p>}

      {!blocked && phase === 'review' && purchase.status === 'PENDING_APPROVAL' && (
        <div className="actions">
          <button className="primary" onClick={approve}>Approve {usd(purchase.amount)}</button>
          <button onClick={() => onReject(purchase._id)}>Decline</button>
        </div>
      )}

      {phase === 'pay' && (
        <div className="paybox">
          <p>You approved {usd(purchase.amount)}. Complete payment with PayPal (Sandbox).</p>
          <PayPalButtons
            style={{ layout: 'vertical', shape: 'rect' }}
            createOrder={async () => (await api.createOrder(purchase._id)).orderId}
            onApprove={async (data) => { try { const done = await api.captureOrder(purchase._id, data.orderID); onPaid(done); } catch (x) { setErr(x.message); onDrift(); } }}
            onCancel={() => setErr('Payment cancelled. Nothing was charged.')}
            onError={(x) => { setErr(x?.message?.includes('Blocked') ? x.message : 'PayPal could not start the payment. Check the message above or try again.'); onDrift(); }}
          />
          <button className="link" onClick={() => onBump(purchase.productSnapshot.id, 5)}>Demo: raise this price by $5 and try again</button>
        </div>
      )}

      {phase === 'done' && <p className="note ok">Captured. PayPal capture ID {purchase.paypalCaptureId}.</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}

function Ledger({ history, audit }) {
  return (
    <section className="panel ledger">
      <h2>History and audit trail</h2>
      <div className={`chain ${audit?.chain.valid ? 'ok' : 'bad'}`}>
        {audit ? (audit.chain.valid ? 'Audit chain verified: no entry has been altered.' : `Audit chain broken at entry ${audit.chain.brokenAt}.`) : 'Loading…'}
      </div>
      <div className="cols">
        <div>
          <h3>Purchases</h3>
          {history.length === 0 && <p className="muted">Nothing yet. Propose a product above.</p>}
          <ul className="rows">{history.map((h) => (
            <li key={h._id}><span>{h.productSnapshot.name}</span><span>{usd(h.amount)}</span><span className={`tag ${h.status}`}>{h.status.replace('_', ' ').toLowerCase()}</span></li>
          ))}</ul>
        </div>
        <div>
          <h3>Decisions</h3>
          <ul className="rows log">{audit?.entries.slice(0, 12).map((e) => (
            <li key={e._id}><span className="muted">{new Date(e.createdAt).toLocaleTimeString()}</span><span>{e.action.replaceAll('_', ' ').toLowerCase()}</span><span className="muted">{e.reason}</span></li>
          ))}</ul>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [email, setEmail] = useState(session.token ? 'signed in' : null);
  const [policy, setPolicy] = useState(null);
  const [products, setProducts] = useState([]);
  const [purchase, setPurchase] = useState(null);
  const [history, setHistory] = useState([]);
  const [audit, setAudit] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [h, a, p] = await Promise.all([api.history(), api.audit(), api.products()]);
      setHistory(h); setAudit(a); setProducts(p);
    } catch (x) { if (x.status === 401) { session.set(null); setEmail(null); } }
  }, []);

  useEffect(() => { if (email) { api.activePolicy().then(setPolicy).catch(() => {}); refresh(); } }, [email, refresh]);

  const propose = async (id) => {
    setBusyId(id); setToast('');
    try { setPurchase(await api.evaluate(id)); await refresh(); } catch (x) { setToast(x.message); } finally { setBusyId(null); }
  };
  const sync = async (id) => { const h = await api.history(); setHistory(h); const p = h.find((x) => x._id === id); if (p) setPurchase(p); setAudit(await api.audit()); };

  return (
    <PayPalScriptProvider options={{ clientId: import.meta.env.VITE_PAYPAL_CLIENT_ID || 'test', currency: 'USD', intent: 'capture' }}>
      <header className="top">
        <div>
          <h1>IntentLock</h1>
          <p>Your AI agent proposes. Rules decide. You approve. PayPal pays.</p>
        </div>
        <div className="badges">
          <span className="badge">PayPal Sandbox · USD · demo catalogue</span>
          {email && <button className="link" onClick={() => { session.set(null); setEmail(null); setPurchase(null); }}>Sign out</button>}
        </div>
      </header>
      <main>
        {!email ? <AuthForm onAuth={setEmail} /> : (
          <>
            <Mandate policy={policy} onSave={async (t) => { setPolicy(await api.setPolicy(t)); setPurchase(null); await refresh(); }} />
            <Shelf products={products} disabled={!policy} onPropose={propose} busyId={busyId} />
            {!policy && <p className="note">Set your spending permissions first. The agent cannot propose anything without them.</p>}
            {toast && <p className="error" role="alert">{toast}</p>}
            {purchase && (
              <Decision
                purchase={purchase}
                onApprove={async (id) => { setPurchase(await api.approve(id)); await refresh(); }}
                onReject={async (id) => { setPurchase(await api.reject(id)); await refresh(); }}
                onPaid={(done) => { setPurchase(done); refresh(); }}
                onBump={async (pid, d) => { await api.bumpPrice(pid, d); setToast(`Price raised by $${d}. Press the PayPal button: IntentLock re-checks before creating the order.`); setProducts(await api.products()); }}
                onDrift={() => sync(purchase._id)}
              />
            )}
            <Ledger history={history} audit={audit} />
          </>
        )}
      </main>
      <footer>Prototype built for the PayPal AI Hackathon. Merchant verification and prices are demo data. No real money moves.</footer>
    </PayPalScriptProvider>
  );
}
