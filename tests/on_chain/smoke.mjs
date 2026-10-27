/* Attentive against GenLayer Studio (chain 61999), with throwaway accounts. Deploys its own copy.
 *
 *   npm ci                                                  # genlayer-js 1.1.8 and viem 2.56.8
 *   node tests/on_chain/smoke.mjs                           # the whole run, from a fresh state
 *   RESUME=1 node tests/on_chain/smoke.mjs                  # continue a run that was cut off
 *   STATE=/some/dir/run.json RESUME=1 node tests/on_chain/smoke.mjs   # the same, with the state kept elsewhere
 *
 * Five generated accounts play the story, known only by their roles: RESEARCHER studies commuting in
 * Harbourside; ALICE takes the bus and says so twice; BEN says he cycles and, three questions later, that he
 * drives every day; CARA answers "depends" and "it varies"; STRANGER holds nothing and tries to reveal
 * somebody else's pairs.
 *
 *   1  deploy Attentive.
 *   2  ALICE, BEN and CARA each deposit 0.01 GEN of credit, the response bond. RESEARCHER opens S1, "Commuting
 *      in Harbourside", six questions, with a 0.6 GEN budget: three rewards of 0.2 GEN. Two pairs are sealed as
 *      sha256("[[1,4],[2,6]]|" + salt), the salt generated here and kept in the state file: Q1 "How do you
 *      usually get to work?" with Q4 "What is your normal way of travelling to your job?", and Q2 "How long is
 *      your typical commute, one way?" with Q6 "On an ordinary day, how many minutes does the trip to work take
 *      you?". The answer window is 1200 s and the reveal window 1800 s.
 *   3  ALICE answers (the bus, the number 12 bus; about 25 minutes, 25) and answers again: refused, one
 *      response per address. BEN answers (he cycles; he drives his car every day; 20 minutes twice). CARA
 *      answers (depends, it varies; hard to say, it varies). No model is asked; each bond leaves credit.
 *   4  the answer window passes on the chain's own clock. STRANGER tries to reveal the pairs with the right
 *      salt: refused, only the researcher may. RESEARCHER reveals them; the code checks the seal.
 *   5  three judgments, each one consensus round asked four ways. ALICE's response, judged by ALICE: both
 *      pairs say the same thing, so 0.2 GEN reaches ALICE and her bond comes back to credit. BEN's, judged by
 *      STRANGER: the first pair contradicts itself, so BEN is not paid and his 0.01 GEN bond reaches
 *      RESEARCHER. CARA's, judged by CARA: neither pair says anything specific, so it is unclear: no reward,
 *      the bond back to credit. ALICE asks for her response to be judged again: refused, judged once.
 *   6  RESEARCHER closes S1, every response being settled, and the 0.4 GEN left come back. ALICE and CARA
 *      withdraw their bonds.
 *   7  the views read back, the code deployed compared with the file byte for byte, the contract's balance
 *      read, and every account's net movement checked against what the receipts say.
 *
 * Every refusal is a signed transaction. Balances are read after finalisation, because a transfer lands at
 * FINALIZED, not at ACCEPTED. Transactions are polled with eth_getTransactionByHash, never with views. A
 * round no majority carried stores nothing and, since judge() carries no value, strands nothing; it is sent
 * again and both transactions are kept. Every step is saved as it is made, so a run cut off part way
 * continues without sending anything twice. Every id (S1, R1 to R3, the contract address) is read from the
 * receipt that created it, never assumed; a step whose receipt does not carry the id it needs stops the run
 * rather than guess. Waits are measured on the chain's own clock: the survey view reports the message clock
 * as `now`. A whole run takes about 35 to 50 minutes: one deployment and 17 transactions, three of them
 * consensus rounds of four askings each, and the rest of the 1200-second answer window.
 *
 * A state file remembers the sha256 of the contract it deployed, and a RESUME against a state made from
 * another file stops before sending anything.
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { generatePrivateKey } from "viem/accounts";
import { getAddress } from "viem";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RPC = "https://studio.genlayer.com/api";
const STATE = process.env.STATE || join(tmpdir(), "attentive-smoke-state.json");
const RECORD = process.env.RECORD || STATE.replace(/\.json$/, "") + "-record.json";
const FILE = new URL("../../contracts/attentive.py", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const rpc = async (m, p) => {
  let last;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) });
      const j = await r.json();
      if (j.error && (j.error.code === -32029 || r.status === 429)) { await sleep(((j.error.data?.retry_after_seconds) || 20) * 1000); continue; }
      if (j.error) { last = new Error(m + ": " + JSON.stringify(j.error).slice(0, 200)); await sleep(6000); continue; }
      return j.result;
    } catch (e) { last = e; await sleep(4000); }
  }
  throw last;
};
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  - " + d : ""}`); return !!c; };
const GEN = 10n ** 18n;
const tally = (v) => `${v.agree} agree, ${v.disagree} disagree, ${v.idle} idle`;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const need = (v, what) => { if (!v) { console.log(`stopping: ${what} was not in the receipt; nothing is assumed`); process.exit(2); } return v; };

// ---------- state: keys, addresses and every step already made survive a cut-off run ----------
const st = existsSync(STATE) && process.env.RESUME ? JSON.parse(readFileSync(STATE, "utf8")) : {};
st.keys = st.keys || {}; st.steps = st.steps || {}; st.views = st.views || {}; st.order = st.order || []; st.ids = st.ids || {};
const SOURCE_SHA = sha(readFileSync(FILE));
if (st.source_sha256 && st.source_sha256 !== SOURCE_SHA) {
  console.log(`the state file ${STATE} belongs to a run of another contract file; start a fresh run without RESUME, or name another STATE`);
  process.exit(2);
}
st.source_sha256 = SOURCE_SHA;
st.salt = st.salt || randomBytes(16).toString("hex");    // 32 hexadecimal characters, revealed on chain at step 4
const save = () => {
  writeFileSync(STATE, JSON.stringify(st, null, 1));
  const { keys, ...shown } = st;       // the record carries no key
  writeFileSync(RECORD, JSON.stringify(shown, null, 1));
};
const ROLES = {
  researcher: "the researcher who opens S1, seals its pairs, reveals them and takes back what is left",
  alice: "a respondent who answers both pairs the same way",
  ben: "a respondent whose first pair contradicts itself",
  cara: "a respondent whose answers say nothing specific",
  stranger: "a stranger, who tries to reveal somebody else's pairs and judges BEN's response",
};
for (const k of Object.keys(ROLES)) st.keys[k] = st.keys[k] || generatePrivateKey();
const acct = {}, client = {};
for (const k of Object.keys(ROLES)) { acct[k] = createAccount(st.keys[k]); client[k] = createClient({ chain: studionet, account: acct[k] }); }
const rd = createClient({ chain: studionet });
st.accounts = Object.fromEntries(Object.keys(ROLES).map((k) => [k, getAddress(acct[k].address)]));
const low = (a) => String(a).toLowerCase();
save();

const balance = async (a) => BigInt(await rpc("eth_getBalance", [a, "latest"]) || "0x0");
const nonceOf = async (a) => Number(BigInt(await rpc("eth_getTransactionCount", [a, "latest"]) || "0x0"));
const fundOnce = async (k, whole) => {
  st.funded = st.funded || {};
  if (st.funded[k]) return;
  await rpc("sim_fundAccount", { account_address: getAddress(acct[k].address), amount: whole * 1e18 });   // checksummed; amount in atto, as a number
  for (let i = 0; i < 20 && (await balance(acct[k].address)) === 0n; i++) await sleep(3000);
  st.funded[k] = String(await balance(acct[k].address)); save();
};

// ---------- transactions ----------
const errText = (e) => String(e?.details || e?.shortMessage || e?.cause?.message || e?.message || e);
// A request the network refused or never received is made again. When the failure is ambiguous the
// sender's nonce says whether the transaction landed after all, and its hash is read back, so nothing is
// ever sent twice.
const sendRaw = async (who, what, make) => {
  const addr = acct[who].address;
  for (let i = 0; ; i++) {
    const n0 = await nonceOf(addr);
    try { return await make(); } catch (e) {
      if (i >= 8) throw e;
      console.log(`      ${what} was not taken (${errText(e).slice(0, 70)}); looking again in 20s`);
      await sleep(20000);
      if ((await nonceOf(addr)) > n0) {
        const list = await rpc("sim_getTransactionsForAddress", [addr]);
        const hit = (list || []).find((t) => low(t.from_address) === low(addr) && Number(t.nonce) === n0);
        if (hit?.hash) return hit.hash;
        throw new Error(what + " landed but its hash could not be read back");
      }
    }
  }
};
const countVotes = (t) => { let a = 0, d = 0, idl = 0; for (const k in (t.consensus_data?.votes || {})) { const v = t.consensus_data.votes[k]; if (v === "agree") a++; else if (v === "disagree") d++; else idl++; } return { agree: a, disagree: d, idle: idl }; };
const wait = async (tx) => {
  let stuck = 0;
  for (let i = 0; i < 900; i++) {
    await sleep(4000);
    const t = await rpc("eth_getTransactionByHash", [tx]);
    if (t?.status === "FINALIZED") {
      const lr = t.consensus_data?.leader_receipt, one = Array.isArray(lr) ? lr[0] : lr;
      let msg = "";
      try { msg = Buffer.from(one.result, "base64").toString("utf8").replace(/[^\x20-\x7e]/g, " ").trim(); } catch (e) {}
      const v = countVotes(t);
      return { tx, msg, exec: one?.execution_result || "", votes: v, applied: v.agree * 2 > v.agree + v.disagree + v.idle, address: t.data?.contract_address || t.to_address || "" };
    }
    // a round no majority carried is final as it stands once it has been left alone for ten minutes
    if (t?.status === "UNDETERMINED" && (stuck = stuck + 1) > 150) return { tx, msg: "UNDETERMINED", exec: "", votes: countVotes(t), applied: false, address: "" };
    if (t?.status === "CANCELED") return { tx, msg: "CANCELED", exec: "", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "" };
    if (i > 0 && i % 75 === 0) console.log(`      [${stamp()}] still ${t?.status || "unknown"} after ${Math.round(i * 4 / 60)} minutes: ${tx}`);
  }
  return { tx, msg: "TIMEOUT", exec: "", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "" };
};
const jsonOf = (msg) => { const b = String(msg).indexOf("{"); if (b === -1) return null; try { return JSON.parse(String(msg).slice(b)); } catch (e) { return null; } };
const settle = async (a, before, want) => { for (let i = 0; i < 45; i++) { const b = await balance(a); if (b - before === want) return b; await sleep(4000); } return await balance(a); };

// One step: a signed transaction, its tally, what it returned, and the balances it moved. opt.watch names
// the roles whose balances are read before and after, opt.expect the change each should show (a table, or
// a function of what the call returned), and opt.again how long to wait before sending a refused step again.
const call = async (id, who, fn, args = [], opt = {}) => {
  if (!st.steps[id]) { st.steps[id] = { id, who, fn, args: args.map(String), value: String(opt.value || 0n), tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (!rec.done) {
    if (!rec.before) { rec.before = {}; for (const k of opt.watch || []) rec.before[k] = String(await balance(acct[k].address)); save(); }
    for (;;) {
      if (!rec.pending) { rec.pending = await sendRaw(who, fn, () => client[who].writeContract({ address: need(st.contract, "the contract address"), functionName: fn, args, ...(opt.value ? { value: opt.value } : {}) })); save(); }
      const r = await wait(rec.pending);
      rec.tries.push({ tx: r.tx, votes: r.votes, exec: r.exec, applied: r.applied, msg: r.msg });
      rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} ${fn}(${args.map((x) => String(x).slice(0, 22)).join(", ")})${opt.value ? " +" + Number(opt.value) / 1e18 + " GEN" : ""}  ${r.tx}  ${tally(r.votes)}  ${r.exec}`);
      if (r.msg === "TIMEOUT" || rec.tries.length >= 4) break;
      if (!r.applied) { console.log("      the validators did not carry that round (" + tally(r.votes) + "), so nothing was stored; sending it again"); continue; }
      const again = opt.again ? opt.again(r) : 0;
      if (again > 0) { console.log(`      not yet; waiting ${Math.round(again / 1000)} s and sending it again`); await sleep(again); continue; }
      break;
    }
    const last = rec.tries[rec.tries.length - 1];
    const expect = typeof opt.expect === "function" ? opt.expect(jsonOf(last.msg)) : opt.expect;
    rec.after = {}; rec.delta = {};
    for (const k of opt.watch || []) {
      const before = BigInt(rec.before[k]);
      const want = expect && expect[k] !== undefined ? BigInt(expect[k]) : null;
      const now = want === null ? await balance(acct[k].address) : await settle(acct[k].address, before, want);
      rec.after[k] = String(now); rec.delta[k] = String(now - before);
    }
    rec.done = true; save();
  }
  const last = rec.tries[rec.tries.length - 1];
  return { ...last, j: jsonOf(last.msg), tries: rec.tries, delta: rec.delta || {} };
};
const refused = (r, words) => r.exec === "ERROR" && r.msg.includes(words);
const moved = (r, k, want) => r.delta[k] === String(want);
const votes = (r) => r.tries.map((t) => tally(t.votes)).join(", then ");

const deploy = async (id, who) => {
  if (!st.steps[id]) { st.steps[id] = { id, who, fn: "deploy contracts/attentive.py", args: [], value: "0", tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (!rec.done) {
    const code = readFileSync(FILE);
    for (;;) {
      if (!rec.pending) { rec.pending = await sendRaw(who, "deploy", () => client[who].deployContract({ code, args: [], leaderOnly: false })); save(); }
      const r = await wait(rec.pending);
      rec.tries.push({ tx: r.tx, votes: r.votes, exec: r.exec, applied: r.applied, msg: r.msg.slice(0, 300) });
      rec.address = r.address; rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} deploy  ${r.tx}  ${tally(r.votes)}  ${r.exec}  ${r.address}`);
      if (r.applied || r.msg === "TIMEOUT" || rec.tries.length >= 3) break;
    }
    rec.done = true; save();
  }
  return need(rec.address, "the address of the deployed contract");
};

// ---------- reads: paced, and made again on a 429 instead of failing ----------
let lastRead = 0;
const read = async (fn, args = []) => {
  for (let i = 0; i < 30; i++) {
    const gap = 3500 - (Date.now() - lastRead);
    if (gap > 0) await sleep(gap);
    lastRead = Date.now();
    try { return JSON.parse(String(await rd.readContract({ address: st.contract, functionName: fn, args }))); } catch (e) {
      if (i === 29) return { error: "VIEW ERROR " + fn + ": " + errText(e).slice(0, 100) };
      await sleep(/rate|429|limit/i.test(errText(e)) ? 25000 : 10000);
    }
  }
};
// a view read once for a check is kept with the run, so a continued run checks what was seen then
const seen = async (id, fn, args = []) => { if (!st.views[id]) { st.views[id] = { fn, args, when: stamp(), out: await read(fn, args) }; save(); } return st.views[id].out; };
// wait, by the chain's own clock, until the answer window has closed: the survey view reports the message
// clock as `now`, and falls back to this machine's clock only when the view carries none
const untilAnswersClose = async (sid) => {
  for (let i = 0; i < 40; i++) {
    const row = await read("survey", [sid]);
    const now = Number(row.now > 0 ? row.now : Math.floor(Date.now() / 1000));
    const left = Number(row.answer_closes || 0) - now;
    if (row.phase !== "answering" && row.phase !== "unknown") return;
    if (left < -15) return;
    console.log(`      [${stamp()}] waiting ${left + 20} s, by the chain clock, for the answer window of ${sid} to close`);
    await sleep((left + 20) * 1000);
  }
};
const notYet = (r) => { const m = /open for another (\d+) seconds/.exec(r.msg); return r.exec === "ERROR" && m ? (Number(m[1]) + 15) * 1000 : 0; };

// ---------- the demonstration ----------
const BOND = GEN / 100n, REWARD = GEN / 5n, BUDGET = 3n * REWARD, ANSWER = 1200, REVEAL = 1800;
const TITLE = "Commuting in Harbourside";
const QUESTIONS = [
  "How do you usually get to work?",
  "How long is your typical commute, one way?",
  "What do you like most about your commute?",
  "What is your normal way of travelling to your job?",
  "What one change would make your commute better?",
  "On an ordinary day, how many minutes does the trip to work take you?",
];
const PAIRS_JSON = "[[1, 4], [2, 6]]", CANONICAL = "[[1,4],[2,6]]";
const DIGEST = sha(CANONICAL + "|" + st.salt);
const ANSWERS = {
  alice: ["I take the bus.", "About 25 minutes.", "Reading on the top deck.", "The number 12 bus.", "A bus lane on Quay Road.", "25"],
  ben: ["I cycle.", "About 20 minutes.", "The fresh air on the river path.", "I drive my car every day.", "Cheaper parking near the office.", "20"],
  cara: ["Depends.", "Hard to say.", "Not much.", "It varies.", "Fewer roadworks.", "It varies."],
};
// what a judgment moves, by how it was read: the respondent is paid the reward, or the researcher the bond
const judgeMoves = (who) => (j) => ({ [who]: BigInt(j?.reward || "0"), researcher: j?.bond_to === "researcher" ? BigInt(j?.bond || "0") : 0n });

await fundOnce("researcher", 2); await fundOnce("alice", 1); await fundOnce("ben", 1); await fundOnce("cara", 1); await fundOnce("stranger", 1);
if (!st.start) { st.start = {}; for (const k of Object.keys(ROLES)) st.start[k] = String(await balance(acct[k].address)); st.started = new Date().toISOString(); save(); }
console.log(`[${stamp()}] ${Object.keys(ROLES).map((k) => k.toUpperCase().padEnd(10) + " " + st.accounts[k] + "  " + ROLES[k]).join("\n           ")}\n           state ${STATE}`);

// ================================================================ 1
console.log(`\n[${stamp()}] ---- 1: deploy`);
st.contract = st.contract || await deploy("deploy", "researcher");
save();
console.log(`      Attentive at ${st.contract}`);
{
  const s = await seen("statsEmpty", "stats", []);
  ok("Attentive is deployed and holds nothing yet", s.surveys === 0 && s.balance_owed === "0", JSON.stringify(s));
}

// ================================================================ 2
console.log(`\n[${stamp()}] ---- 2: the respondents' bonds, and RESEARCHER opens S1 with its pairs sealed`);
{
  for (const who of ["alice", "ben", "cara"]) {
    const d = await call("deposit_" + who, who, "deposit", [], { value: BOND, watch: [who], expect: { [who]: -BOND } });
    ok(`${who.toUpperCase()} deposits 0.01 GEN of credit, the response bond; no model runs`, d.j?.ok === true && d.j?.credit === String(BOND) && moved(d, who, -BOND), votes(d));
  }
  const o = await call("openS1", "researcher", "open_survey", [TITLE, JSON.stringify(QUESTIONS), DIGEST, String(REWARD), ANSWER, REVEAL], { value: BUDGET, watch: ["researcher"], expect: { researcher: -BUDGET } });
  ok("RESEARCHER opens S1: six questions, a 0.6 GEN budget of three 0.2 GEN rewards, the pairs sealed by their digest", o.j?.ok === true && o.j?.questions === 6 && o.j?.rewards === 3 && o.j?.budget === String(BUDGET) && moved(o, "researcher", -BUDGET), `${votes(o)}  ${o.msg.slice(0, 140)}`);
  st.ids.S1 = need(o.j?.survey, "the survey id"); save();
  ok("the survey id is read from the receipt", /^S\d+$/.test(st.ids.S1), st.ids.S1);
  const row = await seen("S1open", "survey", [st.ids.S1]);
  ok("survey(S1): the questions word for word, the digest, no pairs shown, taking answers", JSON.stringify(row.questions) === JSON.stringify(QUESTIONS) && row.pairs_digest === DIGEST && row.pairs === null && row.status === "open" && row.budget_left === String(BUDGET), JSON.stringify({ phase: row.phase, pairs: row.pairs, budget_left: row.budget_left }));
}

// ================================================================ 3
console.log(`\n[${stamp()}] ---- 3: the answers, one response per address`);
{
  const a = await call("respondAlice", "alice", "respond", [st.ids.S1, JSON.stringify(ANSWERS.alice)], { watch: ["alice"], expect: { alice: 0n } });
  ok("ALICE answers all six questions; the bond leaves her credit, no model runs", a.j?.ok === true && a.j?.credit === "0" && a.j?.bond === String(BOND), `${votes(a)}  ${a.msg.slice(0, 120)}`);
  st.ids.R_alice = need(a.j?.response, "ALICE's response id"); save();
  const again = await call("respondAliceAgain", "alice", "respond", [st.ids.S1, JSON.stringify(ANSWERS.ben)], { watch: ["alice"], expect: { alice: 0n } });
  ok("ALICE answers again: refused, one response per address", refused(again, "already answered " + st.ids.S1 + " in " + st.ids.R_alice) && moved(again, "alice", 0n), `${votes(again)}  ${again.msg.slice(0, 140)}`);
  const b = await call("respondBen", "ben", "respond", [st.ids.S1, JSON.stringify(ANSWERS.ben)]);
  ok("BEN answers: he cycles, and he drives his car every day", b.j?.ok === true && b.j?.credit === "0", `${votes(b)}  ${b.msg.slice(0, 120)}`);
  st.ids.R_ben = need(b.j?.response, "BEN's response id"); save();
  const c = await call("respondCara", "cara", "respond", [st.ids.S1, JSON.stringify(ANSWERS.cara)]);
  ok("CARA answers: depends, it varies", c.j?.ok === true && c.j?.credit === "0", `${votes(c)}  ${c.msg.slice(0, 120)}`);
  st.ids.R_cara = need(c.j?.response, "CARA's response id"); save();
  ok("all three response ids are read from the receipts, and differ", [st.ids.R_alice, st.ids.R_ben, st.ids.R_cara].every((x) => /^R\d+$/.test(x)) && new Set([st.ids.R_alice, st.ids.R_ben, st.ids.R_cara]).size === 3, `${st.ids.R_alice} ${st.ids.R_ben} ${st.ids.R_cara}`);
}

// ================================================================ 4
console.log(`\n[${stamp()}] ---- 4: the answer window closes, and the pairs are revealed`);
{
  if (!st.steps.revealByStranger?.done) await untilAnswersClose(st.ids.S1);
  const strange = await call("revealByStranger", "stranger", "reveal_pairs", [st.ids.S1, PAIRS_JSON, st.salt]);
  ok("STRANGER tries to reveal S1's pairs with the right salt: refused, only the researcher may", refused(strange, "only the researcher of " + st.ids.S1 + " may reveal its pairs"), `${votes(strange)}  ${strange.msg.slice(0, 120)}`);
  const rv = await call("revealS1", "researcher", "reveal_pairs", [st.ids.S1, PAIRS_JSON, st.salt], { again: notYet });
  ok("RESEARCHER reveals the pairs and the salt; the code checks them against the seal", rv.j?.ok === true && rv.j?.pairs === CANONICAL && rv.j?.responses === 3, `${votes(rv)}  ${rv.msg.slice(0, 140)}`);
}

// ================================================================ 5
console.log(`\n[${stamp()}] ---- 5: three responses judged, each read four ways in one consensus round`);
{
  const a = await call("judgeAlice", "alice", "judge", [st.ids.R_alice], { watch: ["alice", "researcher"], expect: judgeMoves("alice") });
  ok("ALICE's response: both pairs say the same thing, consistent", a.j?.pairs === "cc" && a.j?.verdict === "consistent", `${votes(a)}  ${a.j?.pairs || a.msg.slice(0, 100)}`);
  ok("and the 0.2 GEN reward reaches ALICE in the same transaction, her bond back in credit", a.j?.reward === String(REWARD) && a.j?.bond_to === "credit" && a.j?.credit === String(BOND) && moved(a, "alice", REWARD) && moved(a, "researcher", 0n), JSON.stringify(a.delta));
  const b = await call("judgeBen", "stranger", "judge", [st.ids.R_ben], { watch: ["ben", "researcher", "stranger"], expect: { ...judgeMoves("ben")(null), stranger: 0n, researcher: BOND } });
  ok("BEN's response, judged by STRANGER: the first pair contradicts itself, contradictory", b.j?.verdict === "contradictory" && String(b.j?.pairs).startsWith("x"), `${votes(b)}  ${b.j?.pairs || b.msg.slice(0, 100)}`);
  ok("and BEN is paid nothing; his 0.01 GEN bond reaches RESEARCHER in the same transaction", b.j?.reward === "0" && b.j?.bond_to === "researcher" && moved(b, "researcher", BOND) && moved(b, "ben", 0n) && moved(b, "stranger", 0n), JSON.stringify(b.delta));
  const c = await call("judgeCara", "cara", "judge", [st.ids.R_cara], { watch: ["cara", "researcher"], expect: judgeMoves("cara") });
  ok("CARA's response: neither pair says anything specific, unclear", c.j?.verdict === "unclear" && !String(c.j?.pairs).includes("x"), `${votes(c)}  ${c.j?.pairs || c.msg.slice(0, 100)}`);
  ok("and no reward is paid; her bond goes back to her credit, nothing moves", c.j?.reward === "0" && c.j?.bond_to === "credit" && c.j?.credit === String(BOND) && moved(c, "cara", 0n) && moved(c, "researcher", 0n), JSON.stringify(c.delta));
  const again = await call("judgeAliceAgain", "alice", "judge", [st.ids.R_alice], { watch: ["alice"], expect: { alice: 0n } });
  ok("ALICE asks for her response to be judged again: refused before any model runs, judged once", refused(again, "each response is judged once") && moved(again, "alice", 0n), `${votes(again)}  ${again.msg.slice(0, 120)}`);
}

// ================================================================ 6
console.log(`\n[${stamp()}] ---- 6: RESEARCHER closes S1, and the respondents take back their bonds`);
{
  const cl = await call("closeS1", "researcher", "close", [st.ids.S1], { watch: ["researcher"], expect: (j) => ({ researcher: BigInt(j?.returned || "0") }) });
  ok("RESEARCHER closes S1 once every response is settled, and the 0.4 GEN left come back", cl.j?.ok === true && cl.j?.waiting === 0 && cl.j?.returned === String(BUDGET - REWARD) && moved(cl, "researcher", BUDGET - REWARD), `${votes(cl)}  ${cl.msg.slice(0, 120)}`);
  for (const who of ["alice", "cara"]) {
    const held = BigInt((await seen("creditBefore_" + who, "credit", [acct[who].address])).credit || "0");
    const w = await call("withdraw_" + who, who, "withdraw", [String(held)], { watch: [who], expect: { [who]: held } });
    ok(`${who.toUpperCase()} withdraws the ${Number(held) / 1e18} GEN bond that came back to her credit`, w.j?.ok === true && w.j?.returned === String(held) && held === BOND && moved(w, who, held), `${votes(w)}  ${w.msg.slice(0, 80)}`);
  }
}

// ================================================================ 7
console.log(`\n[${stamp()}] ---- 7: the views, the code, and the money`);
{
  const row = await seen("S1", "survey", [st.ids.S1]);
  ok("survey(S1): closed, the pairs [[1,4],[2,6]] and the salt shown, three responses, one paid, one contradicted, one unclear", row.status === "closed" && JSON.stringify(row.pairs) === "[[1,4],[2,6]]" && row.salt === st.salt && row.responses === 3 && row.settled === 3 && row.paid === 1 && row.contradicted === 1 && row.unclear === 1 && row.budget_left === "0" && row.returned === String(BUDGET - REWARD) && row.rewards_paid === String(REWARD) && row.bonds_taken === String(BOND), JSON.stringify({ status: row.status, pairs: row.pairs, paid: row.paid, contradicted: row.contradicted, unclear: row.unclear }));
  const ra = await seen("responseAlice", "response", [st.ids.R_alice]);
  ok("response(ALICE's): her six answers word for word, consistent, paid", JSON.stringify(ra.answers) === JSON.stringify(ANSWERS.alice) && ra.verdict === "consistent" && ra.reward === String(REWARD) && low(ra.respondent) === low(acct.alice.address), JSON.stringify({ verdict: ra.verdict, reward: ra.reward }));
  const rb = await seen("responseBen", "response", [st.ids.R_ben]);
  ok("response(BEN's): contradictory, the bond to the researcher", rb.verdict === "contradictory" && rb.bond_to === "researcher" && rb.reward === "0", JSON.stringify({ verdict: rb.verdict, pairs: rb.pairs }));
  const page = await seen("responsesS1", "responses_of", [st.ids.S1, 0, 20]);
  ok("responses_of(S1, 0, 20): three responses, in order, all settled", page.total === 3 && page.rows?.length === 3 && page.rows.every((r) => r.status === "settled") && page.rows[0].response === st.ids.R_alice, JSON.stringify(page.rows?.map((r) => r.verdict)));
  const who = await seen("researcherRow", "researcher", [acct.researcher.address]);
  ok("researcher(RESEARCHER): one survey, revealed, three settled, the record a respondent reads before answering", who.surveys === 1 && who.revealed === 1 && who.settled === 3 && who.consistent === 1 && who.contradicted === 1 && who.unclear === 1 && who.rewards_paid === String(REWARD) && who.bonds_taken === String(BOND), JSON.stringify(who));
  const credits = [];
  for (const k of ["alice", "ben", "cara"]) credits.push(await seen("credit_" + k, "credit", [acct[k].address]));
  ok("credit() is zero for every respondent: nothing is left held for anybody", credits.every((c) => c.credit === "0"), JSON.stringify(credits.map((c) => c.credit)));
  const stats = await seen("stats", "stats", []);
  ok("stats(): one survey, closed, three responses settled, nothing held", stats.surveys === 1 && stats.closed === 1 && stats.responses === 3 && stats.settled === 3 && stats.paid === 1 && stats.balance_owed === "0" && stats.bonds_held === "0" && stats.budgets_held === "0", JSON.stringify(stats));
  const rules = await seen("rules", "rules", []);
  ok("rules(): both questions word for word, four askings, the combine rule and the limits", String(rules.questions?.same).includes("List the numbers of the pairs whose two ANSWERS say the same thing.") && String(rules.questions?.conflict).includes("whose two ANSWERS contradict each other.") && rules.askings?.length === 4 && String(rules.compared).includes("exact string equality") && rules.limits?.length === 4 && String(rules.limits[0]).includes("a careful bot that answers consistently is paid"), Object.keys(rules).join(","));
  ok("the contract's own balance is zero", (await balance(st.contract)) === 0n, String(await balance(st.contract)));

  const bytes = readFileSync(FILE);
  const chain = Buffer.from(String(await rpc("gen_getContractCode", [st.contract])), "base64");
  st.code = { address: st.contract, bytes: chain.length, sha256: sha(chain), file_bytes: bytes.length, file_sha256: sha(bytes), identical: Buffer.compare(chain, bytes) === 0 };
  save();
  ok(`the code deployed at ${st.contract} is byte for byte contracts/attentive.py`, st.code.identical, `${chain.length} bytes, sha256 ${st.code.sha256}`);

  st.end = {}; for (const k of Object.keys(ROLES)) st.end[k] = String(await balance(acct[k].address));
  st.ended = new Date().toISOString(); save();
  // what each account should have gained or lost, read off the receipts: a deposit takes its value and a
  // withdrawal returns it; opening a survey takes the budget and closing it returns what is left; a judgment
  // pays its reward to the respondent, or its bond to the researcher
  const want = Object.fromEntries(Object.keys(ROLES).map((k) => [k, 0n]));
  const respondentOf = { [st.ids.R_alice]: "alice", [st.ids.R_ben]: "ben", [st.ids.R_cara]: "cara" };
  for (const id of st.order) {
    const s = st.steps[id], j = jsonOf(s.tries.at(-1)?.msg || "");
    if (!j?.ok) continue;
    if (s.fn === "deposit") want[s.who] -= BigInt(j.deposited);
    if (s.fn === "withdraw") want[s.who] += BigInt(j.returned);
    if (s.fn === "open_survey") want[s.who] -= BigInt(j.budget);
    if (s.fn === "close") want[s.who] += BigInt(j.returned);
    if (s.fn === "judge") { want[respondentOf[j.response]] += BigInt(j.reward); if (j.bond_to === "researcher") want.researcher += BigInt(j.bond); }
  }
  const net = (k) => BigInt(st.end[k]) - BigInt(st.start[k]);
  ok("over the run every account ends exactly where the receipts say: ALICE 0.2 GEN up, BEN 0.01 GEN down, RESEARCHER 0.19 GEN down", Object.keys(want).every((k) => net(k) === want[k]) && want.alice === REWARD && want.ben === -BOND && want.cara === 0n && want.researcher === BOND - REWARD && want.stranger === 0n, Object.keys(want).map((k) => k.toUpperCase() + " " + Number(net(k)) / 1e18 + " (receipts " + Number(want[k]) / 1e18 + ")").join("  "));
}

st.checks = { pass, fail }; save();
console.log(`\n${pass} passed, ${fail} failed`);
console.log("Attentive:", st.contract);
console.log("transactions:", st.order.reduce((n, id) => n + st.steps[id].tries.length, 0), "in", st.order.length, "steps; sent a second time:", st.order.filter((id) => st.steps[id].tries.length > 1).join(", ") || "none");
for (const id of st.order) { const s = st.steps[id], j = jsonOf(s.tries.at(-1)?.msg || ""); if (j?.verdict) console.log(`${id.padEnd(18)} ${s.tries.map((t) => t.tx + " " + tally(t.votes)).join(" | ")}  ${j.response} ${j.pairs} ${j.verdict}`); }
console.log("record:", RECORD);
process.exit(fail ? 1 : 0);
