# Attentive

A paid survey that pays only attentive respondents. The researcher hides a few
questions that ask the same thing twice in different words; after the answers
are in, the network reads each response's two answers to every hidden pair and
decides whether they say the same thing, contradict each other, or neither. A
consistent response is paid, a contradictory one forfeits its bond to the
researcher, and anything in between gets its bond back.

## The problem

Paid surveys attract people who click through without reading, and scripts
that fill in anything to collect the reward. The usual defence is an attention
check: ask the same question twice, in different words, and drop the responses
whose two answers disagree. Done by the researcher, that check is trusted to
the party who keeps the money a dropped response does not get. Done by a string
match, it fails on the first honest respondent who writes "I take the bus" once
and "the number 12 bus" the second time.

## What it is

A researcher opens a survey of four to ten questions and sends its whole budget
with it: a whole number of rewards, each 0.01 to 5 GEN. Up to three pairs of
those questions ask the same thing twice ("How do you usually get to work?" and
"What is your normal way of travelling to your job?"). Which questions are
paired is sealed when the survey opens, as the sha256 of the pairs and a salt,
so nobody answering can tell which answers will be compared.

Anyone but the researcher answers once per address while the answer window is
open, staking a response bond of 0.01 GEN from credit deposited beforehand.
There is no cap on responses. After the window closes the researcher reveals
the pairs and the salt, and the contract checks them against the seal in code.
Then anyone may have a response judged: one consensus round reads that
response's paired answers and stores one character per pair.

| what the round stores | verdict | the money, in the same call |
|---|---|---|
| every pair `c` | `consistent` | the reward to the respondent while the budget lasts, and the bond back to the respondent's credit |
| any pair `x` | `contradictory` | no reward; the bond to the researcher |
| otherwise | `unclear` | no reward; the bond back to the respondent's credit |

A researcher who does not reveal the pairs by the deadline saves nothing: from
then on every response may claim the reward without judgment while the budget
lasts, its bond back. The researcher takes back what is left of the budget
once every response is settled, or a day after the reveal deadline. From that
same moment a response nobody had judged gets its bond back with
`release_bond`, so no bond waits for ever on a round that never carries.

## How consensus is used

`judge(response)` runs one `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)`
block. Inside its leader closure the model is asked two questions, each twice.
Word for word from the contract:

> **SAME.** For each numbered PAIR, the two questions ask the same thing in
> different words. List the numbers of the pairs whose two ANSWERS say the same
> thing. Answer a list such as [1, 3], or [] for none.

> **CONFLICT.** For each numbered PAIR, the two questions ask the same thing in
> different words. List the numbers of the pairs whose two ANSWERS contradict
> each other. Answer a list such as [2], or [] for none.

Each listing sentence names one relation and joins no second condition. What
the two relations mean is said once, before the pairs, in the same words every
time:

> Read each answer as the respondent's answer to the question just above it.
> Two answers say the same thing when both give the same specific answer: the
> same choice, the same fact or the same amount, in any words. Two answers
> contradict each other when both cannot be true of the same person. An answer
> that gives no specific answer, such as "it depends" or "not sure", neither
> says the same thing as another answer nor contradicts it. Judge only how the
> two answers of a pair relate: not whether they are true, sensible or well
> written.

Each question is asked in two presentations, and the numbers that come back
are mapped to the sealed order in code:

| asking | the pairs shown | inside each pair | question |
|---|---|---|---|
| `same/in_order` | in their sealed order, PAIR_1 first | the lower-numbered question first | SAME |
| `same/reversed` | last first, numbered again from 1 | the two questions swapped | SAME |
| `conflict/in_order` | in their sealed order | the lower-numbered question first | CONFLICT |
| `conflict/reversed` | last first, numbered again from 1 | the two questions swapped | CONFLICT |

Swapping each pair's two questions means even a survey with one pair is shown
two ways. A list answer is read strictly: `{"answer": [...]}` holding whole
numbers from 1 to the number of pairs, each at most once. A string, a fraction,
a boolean, a repeat or a number out of range makes that asking unreadable.

The four lists combine, pair by pair:

| SAME lists it | CONFLICT lists it | stored |
|---|---|---|
| both times | neither time | `c`, consistent |
| neither time | both times | `x`, contradictory |
| anything else, an unreadable asking included | | `?`, unclear |

So a reader led by the number, or by which question comes first, names a
different pair in each presentation and lands on `?`. A reader that calls every
pair the same, or none, lands on `?` too: one that lists everything in both
framings has said each pair both agrees and contradicts.

**Agreement.** Every validator reruns all four askings itself and compares the
stored marks, such as `cx`, by exact string equality. A validator whose own
rerun raises disagrees, and a leader that raised is never agreed with, so an
unreachable model is never stored as an answer. Every model call is written
inside the leader closure; nothing is nested.

**The prompt boundary.** The questions and the answers reach the model fenced
(`<` and `>` replaced, never deleted) between delimiter lines tagged with the
sha256 of the block's own fenced text, after a paragraph that declares every
block untrusted. The door admits only printable ASCII on one line. The model
never sees an amount, an address, the title, an unpaired question or a question
number. The largest possible prompt, three pairs at full length, is 4,966
characters.

## Why GenLayer

Whether "I take the bus" and "The number 12 bus" say the same thing, whether
"About 25 minutes" and "25" do, and whether "I cycle" and "I drive my car every
day" contradict each other, is a judgement about meaning. No string match tells
them apart from "Depends" and "It varies", which say nothing. A single model
call is one reading that whoever runs it controls, and here whoever runs it
would be the researcher, who keeps every bond a contradiction forfeits. On
GenLayer every validator reads the response for itself, in both framings and
both orders, and only marks they agree on exactly move money.

## Who may do what

| call | who | refused how |
|---|---|---|
| `deposit()` | anyone, for their own credit | a call that sends nothing returns `ok: false` |
| `withdraw(amount_atto)` | anyone, from their own credit, any time | raises `[EXPECTED] ...`; nothing was sent |
| `open_survey(title, questions_json, pairs_digest, reward_atto, answer_seconds, reveal_seconds)` | anyone; the sender is the researcher | returns `ok: false` with everything sent |
| `respond(survey, answers_json)` | anyone but the researcher, once per address, while the answer window is open | raises `[EXPECTED] ...`; the bond stays in credit |
| `reveal_pairs(survey, pairs_json, salt)` | only the researcher, once, between the end of the answer window and the reveal deadline | raises `[EXPECTED] ...`, including when the pairs and the salt do not open the seal |
| `judge(response)` | anyone, once per response, after the reveal | raises `[EXPECTED] ...` before any model is asked |
| `claim_unrevealed(response)` | anyone, once per response, from the reveal deadline if the pairs were never revealed | raises `[EXPECTED] ...` |
| `release_bond(response)` | anyone, once per response nobody judged, from a day after the reveal deadline, on a survey whose pairs were revealed | raises `[EXPECTED] ...`, including for a judged response and for one whose pairs were never revealed (it claims instead) |
| `close(survey)` | only the researcher, once, when every response is settled or a day after the reveal deadline | raises `[EXPECTED] ...` |

`judge`, `claim_unrevealed` and `release_bond` are open on purpose: the money
goes only where the verdict or the rule sends it, to the respondent or the
researcher, never to the caller, and a respondent never has to wait for
somebody else to settle them. A static
test fails on any write that neither refuses by sender nor is listed with its
reason.

`respond` takes no value: the bond comes from credit, so a refused response
strands nothing. No call that carries value asks a model.

## The money

| moment | from | to | amount |
|---|---|---|---|
| `deposit` | anyone | the contract, credited to them | what they send |
| `open_survey` | the researcher | the survey's budget | a whole number of rewards, at least one |
| `respond` | the respondent's credit | the response's bond | 0.01 GEN |
| `judge`, consistent, budget left | the budget | the respondent | one reward; the bond back to credit |
| `judge`, consistent, budget spent | | | the bond back to credit |
| `judge`, contradictory | the bond | the researcher | 0.01 GEN |
| `judge`, unclear | the bond | the respondent's credit | 0.01 GEN |
| `claim_unrevealed` | the budget, while it lasts | the respondent | one reward; the bond back to credit |
| `release_bond`, a day after the reveal deadline, a response nobody judged | the bond | the respondent's credit | 0.01 GEN; no reward |
| `close` | what is left of the budget | the researcher | all of it |
| `withdraw` | the contract | the depositor | any part of their credit |
| a refused `deposit` or `open_survey` | the contract | the sender | everything sent |

The contract holds only credit, budgets left and bonds waiting, and `stats()`
publishes their sum as `balance_owed`. The offline suite checks it against the
contract's books after every step of forty seeded random journeys. Every
settlement makes at most one transfer, after everything else is written.

**No bond waits for ever.** A judgment round that no majority carries stores
nothing, and the response keeps waiting; anyone may send `judge` again. Once
the judging period has ended, a day after the reveal deadline and the moment
`close` opens to the researcher, anyone may call `release_bond` on a response
that was never judged: its bond goes back to the respondent's credit, with no
reward and no verdict, and its status becomes `released`. The researcher had
the whole judging period to have it judged, so a contradictory respondent keeps
the bond only if nobody judged them in time. A response whose pairs were never
revealed is not released: it claims the reward instead.

## The limits, stated plainly

- **A careful bot that answers consistently is paid.** The check catches
  inattention and contradiction, not dishonesty: a respondent, or a script,
  that tells the same lie twice in matching words is consistent.
- **The budget pays first-judged-first.** A consistent response judged after
  the budget is spent gets its bond back and no reward.
- **Nothing tells a researcher's second address from a respondent.** A
  researcher who answers their own survey from other addresses knows the pairs,
  so those responses read consistent, and can have them judged first the
  moment the pairs are revealed, taking rewards back out of the budget.
  `researcher(address)` shows every researcher's record of surveys, reveals and
  rewards paid before anybody answers.
- **The researcher chooses the pairs.** Two questions that do not really ask
  the same thing can make honest answers read as contradictory. The pairs are
  public once revealed, and the researcher's record shows how often their
  respondents were found contradictory.
- **The seal is as secret as the salt.** Ten questions can be paired only a few
  thousand ways; the contract checks that the salt is 16 to 64 printable
  characters, not that it is random.
- **Answers are public as soon as they are sent.** A late respondent can copy
  an earlier respondent's answers, and is then as consistent as they were.
- **Only paired answers are judged.** An answer to an unpaired question is
  stored and never read by the network.
- **A vague answer reads as unclear.** "It depends" to both questions of a pair
  gets the bond back and no reward.
- **A researcher who never closes leaves the rest of their own budget held.**
  Only the researcher can close, because a close ends rewards for responses
  still to be judged.
- **English, in printable ASCII, on one line.** Questions are 10 to 200
  characters, answers 1 to 300, titles 3 to 80. The door refuses anything else.
- **No readable clock, nothing recorded.** The clock is the message clock,
  `gl.message_raw["datetime"]`.

## What is in this repository

```
contracts/attentive.py      the contract
tests/test_pure.py          the offline suite: the doors, the round with a scripted model per node, the money
tests/MUTATIONS.md          every defence removed in turn, and the test that caught it
tests/on_chain/smoke.mjs    a throwaway-account run against Studio
tools/mutate.py             the generator that writes MUTATIONS.md and refuses to if anything survives
CONTRACTS.md                purpose, consensus, state, methods, bounds, reuse and limits
DECISIONS.md                why each rule is the way it is, and what is verified and what is not
```

## Running it

```
pip install -r requirements-dev.txt
pytest tests/ -q                                 # no network, no Studio
genvm-lint check contracts/attentive.py          # the package is genvm-linter, the command genvm-lint
python tools/mutate.py                           # rewrites tests/MUTATIONS.md; exits 1 if a mutant survives
```

- `pytest tests/ -q` gives **393 passed** in a few seconds, with nothing
  installed but pytest.
- `genvm-lint check` version 0.11.0 prints `Lint passed (3 checks)` and
  `Validation passed`, reads Attentive as 16 methods (7 view, 9 write), and
  exits 0.
- `python tools/mutate.py` removes or inverts **313 defences** one at a time,
  and **none survives**; `tests/MUTATIONS.md` names the test that failed for
  each.

The on-chain run generates its own keys and funds them over the network's own
RPC; it never touches a wallet of anybody's own:

```
npm ci
node tests/on_chain/smoke.mjs                    # the whole run, about 35 to 50 minutes
RESUME=1 node tests/on_chain/smoke.mjs           # continue a run that was cut off
STATE=run.json RESUME=1 node tests/on_chain/smoke.mjs
```

It plays five generated accounts. The researcher opens S1, "Commuting in
Harbourside", six questions with a 0.6 GEN budget of three 0.2 GEN rewards,
and seals two pairs: Q1 "How do you usually get to work?" with Q4 "What is your
normal way of travelling to your job?", and Q2 "How long is your typical
commute, one way?" with Q6 "On an ordinary day, how many minutes does the trip
to work take you?". Alice takes the bus and says so twice, about 25 minutes and
25; her second response is refused. Ben says he cycles and, three questions
later, that he drives his car every day. Cara answers "Depends" and "It
varies". A stranger tries to reveal the pairs with the right salt and is
refused; the researcher reveals them. Three judgments follow: Alice consistent
and paid 0.2 GEN, Ben contradictory with his 0.01 GEN bond to the researcher,
Cara unclear with her bond back; Alice's second judgment is refused. The
researcher closes S1 and takes back 0.4 GEN, and Alice and Cara withdraw their
bonds. It prints one PASS or FAIL line per check, reads every account's balance
against the receipts, and compares the deployed code with
`contracts/attentive.py` byte for byte. Every step is saved to the state file
as it is made, so a run that outlives its process continues where it stopped
without sending anything twice.

## Network

Studio, chain 61999. RPC `https://studio.genlayer.com/api`, explorer
`https://explorer-studio.genlayer.com`. The contract pins the runner
`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` in its first
line.

## Evidence

Run on 28 October 2026 on GenLayer Studio (chain 61999) by `tests/on_chain/smoke.mjs`, from generated accounts funded from the
Studio faucet, none of them anybody's wallet: **RESEARCHER** opens the survey, **ALICE**, **BEN** and **CARA** answer, **STRANGER** tries what it may not. **35 passed, 0 failed**; transactions: 18 in 18 steps; sent a second time: none.
The whole log is `tests/on_chain/smoke-run.log`. The pairs were sealed as Q1/Q4 and Q2/Q6 and revealed after answering closed. Alice's paired answers read consistent (cc) and her 0.2 GEN reward reached her in the same transaction; Ben said he cycles and that he drives his car every day, read contradictory (xc), and his bond went to the researcher; Cara's "depends" and "it varies" read unclear (??), with her bond back and no reward. The researcher closed the survey and took back the 0.4 GEN left.

- `deploy` deployed at [`0xff570730958cbe5E8d7d73dB7E9b1b56d460C945`](https://explorer-studio.genlayer.com/address/0xff570730958cbe5E8d7d73dB7E9b1b56d460C945)

- the code deployed at 0xff570730958cbe5E8d7d73dB7E9b1b56d460C945 is byte for byte contracts/attentive.py: 75047 bytes, sha256 7713e92b361687cbdb8c4ec5fd4135d4424f89b916ca6762ed06d787d01090f5

| step | by | transactions | votes |
|---|---|---|---|
| Attentive is deployed and holds nothing yet | RESEARCHER | [0xc7bee7a9…](https://explorer-studio.genlayer.com/tx/0xc7bee7a94d5d14ee2838ebf6496538169361712281c551a3c941392a6b973279) | 3 agree, 0 disagree, 2 idle |
| ALICE deposits 0.01 GEN of credit, the response bond; no model runs | ALICE | [0x3deb9d29…](https://explorer-studio.genlayer.com/tx/0x3deb9d290461ba351625203d8f205857041c055f226343a37cba224976682441) | 3 agree, 0 disagree, 2 idle |
| BEN deposits 0.01 GEN of credit, the response bond; no model runs | BEN | [0xcfd83a51…](https://explorer-studio.genlayer.com/tx/0xcfd83a5158433e4649c3e5b06c569a041a735ebde9ba11edb0443feaab7e48a5) | 3 agree, 0 disagree, 2 idle |
| CARA deposits 0.01 GEN of credit, the response bond; no model runs | CARA | [0x577a015b…](https://explorer-studio.genlayer.com/tx/0x577a015b338e277d595102dc4825c6862ff0793320ad3263f9ae117a1e700f7b) | 4 agree, 0 disagree, 1 idle |
| RESEARCHER opens S1: six questions, a 0.6 GEN budget of three 0.2 GEN rewards, the pairs sealed by their digest | RESEARCHER | [0x710efe1e…](https://explorer-studio.genlayer.com/tx/0x710efe1e43df6bf33275d507856edcca88958165a274cf2c1da029e81885f3ea) | 3 agree, 0 disagree, 2 idle |
| ALICE answers all six questions; the bond leaves her credit, no model runs | ALICE | [0xcc61943c…](https://explorer-studio.genlayer.com/tx/0xcc61943ca45fb54a331600ed7f69df140e4aa9d26ab7ad99c9ff0d40036ad21b) | 3 agree, 0 disagree, 2 idle |
| ALICE answers again: refused, one response per address | ALICE | [0x46003096…](https://explorer-studio.genlayer.com/tx/0x460030963fc422444fb8d24cc3d916d6f252c45dcda7fdf7bdaefb3101f2ac23) | 3 agree, 0 disagree, 2 idle |
| BEN answers: he cycles, and he drives his car every day | BEN | [0x0e937827…](https://explorer-studio.genlayer.com/tx/0x0e9378272577981742d412871b18f6d32fa1bbf1ad9bee6741c641a0e82e74da) | 3 agree, 0 disagree, 2 idle |
| CARA answers: depends, it varies | CARA | [0xe76dcc1c…](https://explorer-studio.genlayer.com/tx/0xe76dcc1c7b63057ec9e751ceed1eb85ae8f18d9c6a85bbc08647dbfd7624fab2) | 3 agree, 0 disagree, 2 idle |
| STRANGER tries to reveal S1's pairs with the right salt: refused, only the researcher may | STRANGER | [0x7368223b…](https://explorer-studio.genlayer.com/tx/0x7368223bf3594102238cb85a744fa29b7082816a0dfa6108a7259828113ce1ae) | 3 agree, 0 disagree, 2 idle |
| RESEARCHER reveals the pairs and the salt; the code checks them against the seal | RESEARCHER | [0xf9c86d4b…](https://explorer-studio.genlayer.com/tx/0xf9c86d4b8e02a99fef69c30cb595a2a58203bc39d7c28aa230c75fa55e1026cc) | 4 agree, 0 disagree, 1 idle |
| ALICE's response: both pairs say the same thing, consistent | ALICE | [0xef6f77ab…](https://explorer-studio.genlayer.com/tx/0xef6f77ab544f33e42dd0f25e51ae5cd92448fa17b78361fb2296b6bc830bdc83) | 3 agree, 0 disagree, 2 idle |
| BEN's response, judged by STRANGER: the first pair contradicts itself, contradictory | STRANGER | [0xc95bfc76…](https://explorer-studio.genlayer.com/tx/0xc95bfc76c249f5235ec264641b37b8f86358e18dfc55146921afb8727e50ba6b) | 3 agree, 0 disagree, 2 idle |
| CARA's response: neither pair says anything specific, unclear | CARA | [0x892dcc46…](https://explorer-studio.genlayer.com/tx/0x892dcc4645f0873f53bd2282df9e8e8a2bdcbfbd0b58a8db38fbf61493c32497) | 3 agree, 0 disagree, 2 idle |
| ALICE asks for her response to be judged again: refused before any model runs, judged once | ALICE | [0x630fbb49…](https://explorer-studio.genlayer.com/tx/0x630fbb49ac3725701dc0ff848ac8202a4148c5e08455539e50208dfbeb6d09f2) | 3 agree, 0 disagree, 2 idle |
| RESEARCHER closes S1 once every response is settled, and the 0.4 GEN left come back | RESEARCHER | [0xc6a84431…](https://explorer-studio.genlayer.com/tx/0xc6a844316c39338aeda9804e0f0638daad43d6fa02b4783c90a1d378acd977e4) | 5 agree, 0 disagree, 0 idle |
| ALICE withdraws the 0.01 GEN bond that came back to her credit | ALICE | [0x0690fb24…](https://explorer-studio.genlayer.com/tx/0x0690fb241790b90d14c9a32a83fab3a66d3c70af22a623cebbd78ad89b86a0f7) | 5 agree, 0 disagree, 0 idle |
| CARA withdraws the 0.01 GEN bond that came back to her credit | CARA | [0x1bd4abaa…](https://explorer-studio.genlayer.com/tx/0x1bd4abaa3f1e7cc5b60c0a421c7282e7e5a66250231b8a0836284c948a55fb64) | 3 agree, 0 disagree, 2 idle |

## Licence

MIT. See `LICENSE`.
