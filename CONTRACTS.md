# Contracts

One file. `contracts/attentive.py`, class `Attentive`, is the contract. The
consequence of its verdict is inside it: the judgment that reads a response is
the call that pays it, or forfeits its bond.

## Attentive

### Purpose

A paid survey that pays only attentive respondents. A researcher opens a survey
with its whole budget and seals which of its questions are paraphrase pairs.
Respondents answer once per address, each staking a response bond from credit.
After the answer window the researcher reveals the pairs, the contract checks
them against the seal, and each response is judged once by the network: its two
answers to every sealed pair are read as the same, contradictory or neither. A
consistent response is paid the reward while the budget lasts; a contradictory
one forfeits its bond to the researcher; anything else gets its bond back. A
researcher who never reveals pays every response without judgment. A response
nobody had judged by the end of the judging period has its bond released back
to its respondent's credit, so a round that never carries holds no bond for
ever. Every response is settled in its own call, with at most one transfer, and every loop
is bounded by a constant, so no settlement grows with the number of responses.

### Consensus

One round, `_attention_round(pairs)`: one `gl.vm.run_nondet_unsafe(leader_fn,
validator_fn)` block with four sequential askings in its leader closure. All
four `gl.nondet.exec_prompt` calls in the file are written inside that closure;
no helper beside it calls the model, and nothing is nested. It runs only in
`judge()`, after every refusal and before every write.

`pairs` is a list of at most `MAX_PAIRS` (3) tuples, each the lower-numbered
question, this response's answer to it, the higher-numbered question and this
response's answer to it, built by `_paired(sid, rid, pair_count)` from the
stored rows. The askings are built by `_task(pairs, framing, order)`:

| `ASKED_AS` | framing | order | what is shown |
|---|---|---|---|
| `same/in_order` | `FRAMING_SAME` | `IN_ORDER` | PAIR_k is the k-th sealed pair, its lower-numbered question first |
| `same/reversed` | `FRAMING_SAME` | `REVERSED` | PAIR_k is the k-th sealed pair from the end, its two questions swapped |
| `conflict/in_order` | `FRAMING_CONFLICT` | `IN_ORDER` | as `same/in_order` |
| `conflict/reversed` | `FRAMING_CONFLICT` | `REVERSED` | as `same/reversed` |

The questions are `QUESTION_SAME` ("For each numbered PAIR, the two questions
ask the same thing in different words. List the numbers of the pairs whose two
ANSWERS say the same thing. Answer a list such as [1, 3], or [] for none.") and
`QUESTION_CONFLICT` ("For each numbered PAIR, the two questions ask the same
thing in different words. List the numbers of the pairs whose two ANSWERS
contradict each other. Answer a list such as [2], or [] for none."), one
relation each. `SCOPE` says, before the pairs, what each relation means and
that an answer with no specific answer relates to nothing. `RETURN_LIST` asks
for `{"answer": [...]}` and nothing else.

`_read_list(raw, count, order)` reads one reply as a mask over the sealed
order: `{"answer": [...]}` with whole numbers 1 to `count`, each at most once; a
number in a reversed asking is mapped back as `count - number`. Anything else,
a string, a fraction, a boolean, a repeat or a number out of range, is `""`.
`_combine(same_1, same_2, conflict_1, conflict_2, count)` gives one character
per pair: `c` when both SAME masks have it and neither CONFLICT mask does, `x`
when both CONFLICT masks have it and neither SAME mask does, `?` otherwise; any
unreadable mask makes every pair `?`. The stored value is `{"pairs": ...}`, such
as `{"pairs": "cx"}`.

**The comparison.** `validator_fn` is one line, `return _agrees(leaders_res,
leader_fn)`. `_agrees` returns `False` for a leader that raised and for a result
that is not a dictionary, reruns the whole leader closure inside `try/except`
(its own failure is a disagreement), and compares the marks by exact string
equality. `_clean_pairs` then stores the agreed marks only when they are
exactly one of `c`, `x`, `?` per pair; anything else is every pair `?`.

**The verdict.** `_verdict_of(marks)`: `contradictory` when any pair is `x`,
`consistent` when every pair is `c`, `unclear` otherwise.

**The prompt boundary.** `_block(label, text)` fences the text and writes it
between `<<<LABEL tag>>>` and `<<<END LABEL tag>>>`, `tag` being the first 16 hex
characters of the sha256 of the fenced body; it is the only place a delimiter
is written. The labels are the contract constants `PAIR_1` to `PAIR_3`. Before
the blocks each prompt says every block is untrusted, that what a block says
about the task, the answer or itself counts for nothing, and that the order and
the numbers carry no meaning. No amount, no address, no title and no question
number is a parameter of `_task` or the round.

### State

Three storage dataclasses of scalars only (a collection inside a storage
dataclass kills the VM):

| `Survey` field | type | what it is |
|---|---|---|
| `researcher`, `title`, `question_count` | `Address`, `str`, `u32` | who opened it, its title and how many questions it asks |
| `reward`, `budget`, `budget_left`, `returned` | `u256` | the reward per consistent response, the budget sent, what is left, and what `close` returned |
| `opened_at`, `answer_closes`, `reveal_closes`, `revealed_at`, `closed_at` | `u64` | the windows and the moments, on the message clock |
| `pairs_digest`, `pairs`, `salt`, `pair_count` | `str`, `str`, `str`, `u32` | the seal in lower-case hex, and once revealed the canonical pairs, the salt and how many |
| `status` | `str` | `open` or `closed` |
| `responses`, `settled`, `consistent`, `paid`, `unpaid`, `contradicted`, `unclear`, `unrevealed`, `released` | `u32` | counts of responses, by how they were settled |
| `rewards_paid`, `bonds_taken` | `u256` | rewards paid out and bonds forfeited to the researcher |

| `Response` field | type | what it is |
|---|---|---|
| `survey`, `respondent`, `number`, `at` | `str`, `Address`, `u32`, `u64` | the survey, who answered, which response to it this was, and when |
| `status` | `str` | `waiting`, `settled`, or `released` when its bond came back unjudged |
| `marks`, `verdict` | `str` | the stored consensus value, one of `c`, `x`, `?` per pair, and the verdict: `consistent`, `contradictory`, `unclear` or `unrevealed`; both empty for a released response |
| `reward`, `bond`, `bond_to`, `settled_at` | `u256`, `u256`, `str`, `u64` | the reward paid, the bond staked, where it went (`credit` or `researcher`), and when |

`Researcher` holds one researcher's record: `surveys`, `revealed`, `settled`,
`consistent`, `contradicted`, `unclear`, `unrevealed`, `released` (`u32`) and
`rewards_paid`, `bonds_taken` (`u256`).

| map | key | value |
|---|---|---|
| `survey_rows` | `S1`, `S2`, ... (contract-assigned) | the `Survey` |
| `question_rows` | `S1:4` | the fourth question of S1, as written |
| `pair_rows` | `S1:2:a`, `S1:2:b` | the lower and higher question number of S1's second pair |
| `response_rows` | `R1`, `R2`, ... (contract-assigned) | the `Response` |
| `answer_rows` | `R7:4` | R7's answer to the fourth question |
| `response_index_rows` | `S1:3` | the id of the third response to S1 |
| `responded_rows` | `S1:<address>` | that address's response to S1: one per address |
| `credit_rows` | `<address>` | that address's credit for response bonds, in atto |
| `researcher_rows` | `<address>` | that researcher's `Researcher` record |

Addresses in keys are lower case. `credits_held`, `budgets_held` and
`bonds_held` are what the contract owes, and their sum equals its balance after
every call.

### Key methods

| method | kind | what it does |
|---|---|---|
| `deposit()` | payable write | credits the value to the sender; asks no model; a call that sends nothing returns `ok: false` |
| `withdraw(amount_atto)` | write | part or all of the sender's credit, one transfer |
| `open_survey(title, questions_json, pairs_digest, reward_atto, answer_seconds, reveal_seconds)` | payable write | the doors (a title of 3 to 80 characters; a flat JSON array of 4 to 10 distinct questions of 10 to 200; a 64-character hex digest; a reward of 0.01 to 5 GEN; two windows of ten minutes to seven days; a budget that is a whole number of rewards; a clock) return everything sent on refusal; stores the survey, its questions and its seal; asks no model |
| `respond(survey, answers_json)` | write, takes no value | anyone but the researcher, once per address, while the answer window is open: one answer of 1 to 300 characters to each question, in order; stakes the bond from credit; asks no model |
| `reveal_pairs(survey, pairs_json, salt)` | write | the researcher, once, between the end of the answer window and the reveal deadline: 1 to 3 pairs of different questions, no question in two pairs, and a salt of 16 to 64 printable characters with no space, checked against the seal in code |
| `judge(response)` | write, takes no value | anyone, once per response, after the reveal: the doors raise before any model; then the round, and the response is settled in this call |
| `claim_unrevealed(response)` | write | anyone, once per response, from the reveal deadline if the pairs were never revealed: the reward while the budget lasts, the bond back |
| `release_bond(response)` | write | anyone, once per response nobody judged, from `JUDGING_PERIOD` after the reveal deadline, on a survey whose pairs were revealed: the bond back to the respondent's credit, no reward, status `released`; asks no model, moves nothing out |
| `close(survey)` | write | the researcher, once, when every response is settled or `JUDGING_PERIOD` after the reveal deadline: the budget left back to the researcher |
| `survey(survey_id)` | view | the questions word for word, the reward, the budget left, the windows, the phase, the digest, the pairs and the salt once revealed, and the counts |
| `response(response_id)` | view | the answers word for word, the marks, the verdict and where the money went, with the reason |
| `responses_of(survey_id, offset, limit)` | view | a page of at most 20 responses to one survey, oldest first |
| `credit(who)` | view | one address's credit |
| `researcher(who)` | view | one researcher's record, readable before anybody answers |
| `stats()` | view | counts, `credits_held`, `budgets_held`, `bonds_held` and `balance_owed` |
| `rules()` | view | both questions word for word, the four askings, how a reply is read, the combine rule, what is compared, the money, the windows, who may do what, the seal, the sizes and the limits |

Every view takes ids, small integers or an address: a Studio read fails once the
encoded call passes 256 bytes.

### Bounds

| constant | value | what it bounds |
|---|---|---|
| `MAX_PAIRS` | 3 | sealed pairs; the loops of `_read_pairs`, `_canonical`, `_task`, `_read_list`, `_combine`, `_paired`, `_pair_numbers` and `reveal_pairs` |
| `MAX_QUESTIONS` | 10 | questions, and so answers; the loops of `_read_questions`, `_read_answers`, `_questions`, `_answers`, `open_survey` and `respond` |
| `PAGE_CAP` | 20 | rows per page of `responses_of()` |

`judge()`, `claim_unrevealed()`, `release_bond()`, `close()`, `withdraw()` and
`deposit()` contain no loop of their own, and no settlement reads another response. The only other
loops read the characters of one capped argument or the parts of the message
clock. A static test fails on any other loop.

### Reuse

`response(id)` is the reusable answer: `verdict` `consistent` means the network
agreed that every sealed pair of that response gives the same answer twice.
`researcher(address)` is a reusable reputation: how many of a researcher's
responses were paid, found contradictory or settled unrevealed. The round is
reusable on its own: `_attention_round` decides, for up to three pairs of
question-and-answer texts, which give the same answer twice and which
contradict themselves, with every disagreement stored as `?` rather than
smoothed away.

### Limits

- A careful bot that answers consistently is paid: the check catches
  inattention and contradiction, not dishonesty.
- The budget pays first-judged-first, and a researcher's second address is
  indistinguishable from a respondent.
- The researcher chooses the pairs; the pairs are public once revealed and the
  researcher's record is public before anybody answers.
- Only paired answers are judged; answers are public as soon as they are sent.
- A response nobody judged by the end of the judging period keeps its bond,
  whatever it would have read: `release_bond` returns it with no reward.
- English questions and answers in printable ASCII on one line.
- A transaction with no readable clock is refused, never guessed.
