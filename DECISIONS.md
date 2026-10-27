# Decisions

The boundary first, then the round, the prompt, the seal, the storage, the
money, why every settlement is bounded, the doors, then what is verified and
what is not.

## 1. The boundary: what the network agrees on

**One character per pair.** The round stores `c`, `x` or `?` for each sealed
pair, nothing else. What has to be decided is whether a respondent gave the
same answer twice, and a closed set of three marks is the coarsest answer that
carries it while leaving room for "neither". A score of how attentive a
response was, or a quotation of the clashing words, would put values in
storage that honest nodes could reach differently while believing the same
thing.

**Three marks, not two.** "Depends" and "It varies" neither agree nor
contradict: they say nothing. A two-valued question would have to push them
into one side, and either side moves money wrongly: paid for saying nothing, or
the bond forfeited for being vague. So the round has a third value, and the
money treats it as the honest middle: no reward, the bond back.

**What a program can check, the program checks.** Whether the revealed pairs
open the seal; whether they name real, different questions with none in two
pairs; whether an address already answered; whether the answer window is open;
whether the credit holds the bond; whether the budget holds a reward: every one
of these is decided in code before any model is asked. The network is asked
only what code cannot answer: do these two answers say the same thing.

**It never sees money or people.** `_task` takes the paired questions and that
one response's answers to them, a framing and an order. No amount, no address,
no title and no question number is a parameter, and a test checks that none
appears in any prompt, nor any unpaired question or answer.

## 2. Two questions, both orders, one block

**Two framings, one relation each.** SAME asks which pairs' answers say the same
thing; CONFLICT asks which contradict each other. They are not each other's
negation, because a vague answer is neither, and that is the point: a pair is
`c` only when SAME lists it both times and CONFLICT neither time, `x` only the
other way round. A reader that lists a pair in both framings, or in neither,
has not settled what it believes about it, and the round stores `?`, never a
guess. A reader that affirms everything, or denies everything, pays nothing.

**One plain thing per question.** A question that joins two conditions reads
"unclear" where the honest answer is clear, because a reader can satisfy one
half and not the other. Each listing sentence names one relation; the sentence
before it states what the researcher sealed (the two questions ask the same
thing), and the one after it says what an empty list means. A test fails on any
conjunction in the listing sentence.

**Both presentations.** Every node builds the prompts the same way, so a reader
that favours pair 1, or the question read first, favours it on every node and
consensus alone would never see it. So each framing is asked twice: pairs in
their sealed order, lower-numbered question first; and pairs reversed and
numbered again, each pair's two questions swapped. The swap matters for a
survey of one pair, where reversing the list changes nothing. A reader led by
position names a different pair in each presentation, and the two answers,
mapped back to the sealed order, differ: `?`.

**All four in one block, every call inside the closure.** Nested nondet blocks
are not legal, and separate blocks would be separate rounds that could settle
differently. One leader closure asks all four sequentially and combines them in
code, so every disagreement lands in the stored value. Every
`gl.nondet.exec_prompt` call is written inside that closure. An earlier draft
put the call in a one-line helper beside the closure, which the closure called;
it ran the same, but on the page it is the shape a reviewer rejected in another
contract, a prompt call outside the closures the consensus flow recognises. The
self-audit moved the four calls into the closure, and a static test now fails on
any `gl.nondet` call anywhere else in the file.

**Lists parsed strictly.** A reply counts only as `{"answer": [...]}` with whole
numbers from 1 to the number of pairs, each once. A number as a string, a
fraction, a boolean, a repeat, a number out of range or a bare list is
malformed, and a malformed asking makes every pair `?` rather than being
repaired. A JSON fraction is refused by the parser hook before it is built.

**Exact equality, and no agreement with an error.** There is no tolerance
anywhere: validators compare the marks by exact string equality. A validator
whose own rerun raises disagrees; a leader that raised is never agreed with, so
an unreachable model is never stored as an answer. A round no majority carries
stores nothing; the response keeps waiting and can be judged again.

## 3. The prompt

**The fence and the tag.** Every question and answer passes through `_fence`,
which replaces `<` with `(` and `>` with `)` and never deletes. Each pair sits
between two delimiter lines tagged with the first 16 hex characters of the
sha256 of its own fenced body. A respondent writes both answers of every pair,
and can compute a block's tag; once fenced, an answer holds no angle bracket and
cannot write a line that starts with `<<<`. A test plants another pair's genuine
closing line inside an answer and finds exactly the expected delimiters.

**ASCII on one line at the door.** The fence knows only the two ASCII brackets,
and Unicode has look-alikes a model reads as brackets, so the door refuses
anything outside printable ASCII. A line break would let an answer start a
`Question:` line of its own, so it is refused too.

**Nothing judged is sampled.** Every text over its cap is refused at the door,
so the round reads every paired answer whole. The largest possible prompt,
three pairs of 200-character questions and 300-character answers, is 4,966
characters.

**The declaration.** Before the blocks each prompt says every block is
untrusted, written by the researcher and the respondent, that what a block says
about the task, the answer or itself counts for nothing, and that the order and
the numbers carry no meaning.

## 4. The seal

**Why sealed.** A respondent who knew which questions are paired could answer
those carefully and the rest at random. So the pairs are committed when the
survey opens, as `sha256(canonical + "|" + salt)`, and revealed only after the
answer window closes.

**The digest is checked at the door.** Exactly 64 hexadecimal characters, stored
in lower case; anything else returns the budget.

**One way to write the pairs.** The revealed pairs are read strictly (digits,
brackets, commas and spaces, at most 64 characters, 1 to 3 pairs of two
different question numbers of this survey, no question in two pairs), then
written canonically: lower question first, sorted, no spaces. The seal is
checked on the canonical form, so the same pairs written another way still
open it, and different pairs never do.

**Revealed once, by the researcher, in a window.** From the end of the answer
window until the reveal deadline. Once revealed the pairs and the salt are
stored and never change; a second reveal is refused.

**Why a salt.** Ten questions can be paired only 3,825 ways, so a bare digest
of the pairs would fall to a search in a moment. The salt is 16 to 64 printable
characters with no space. The contract cannot check that it is random; that is
the researcher's own secret to keep, and a guessable salt only hurts the
researcher.

**Not revealing never pays.** If the reveal deadline passes with the pairs
sealed, every response may claim the reward without judgment while the budget
lasts, its bond back. Revealing pays only the consistent responses and earns the
bonds of the contradictory ones, so a researcher is never better off hiding the
pairs, whatever the answers turned out to be.

## 5. The storage

Scalars only inside the three `@allow_storage` dataclasses: a collection inside
a storage dataclass kills the VM. Questions, answers and pairs are rows of their
own keyed by the survey or response id and a number. Credit is one `u256` row
per address. Ids are assigned by the contract from its counters. The callers'
JSON is capped before it is read (4,200 characters of questions, 6,200 of
answers, 64 of pairs), refused if it nests, and parsed with hooks that refuse
fractions, NaN and Infinity; every argument is checked with `isinstance` before
a string method touches it. Addresses in keys are lower case, so one address is
one respondent in any letter case.

## 6. The money

**The bond comes from credit.** `respond` takes no value. A response stakes its
bond from credit deposited by `deposit()`, which asks no model, so a refused
response raises and strands nothing. `judge` takes no value either: a round can
end with nothing stored, and value sent with a call that stores nothing is not
safely returned.

**The budget is sent whole.** `open_survey` takes the whole budget, a whole
number of rewards, so every reward the survey promises is held from the start.
It asks no model and never raises after taking value: every refusal returns
everything sent with `{"ok": false, "reason", "returned"}`. The same holds for
`deposit`. Static tests follow every helper the two payable calls reach and
find no `raise`, no `_fail` and no round.

**The response bond, 0.01 GEN.** It is the price of a contradiction, paid to the
researcher whose check caught it. An unclear response, or a consistent one the
budget can no longer pay, gets it back: an unclear round shows nothing either
way.

**Every transfer is the last thing a call does.** State first, money after, at
most one transfer per settlement, and tests read the state at the moment of
each transfer.

**Conservation.** At every moment the contract holds the credit of every
address, every survey's budget left and every bond still waiting, no more and
no less. The suite checks the books after every step of forty seeded random
journeys.

**Defaults.** A researcher who never reveals: every response claims the reward.
A respondent nobody judges: anyone, the respondent included, may judge. A
researcher who never closes: the rest of the budget stays theirs and held. A
round that no majority carries: nothing is stored and `judge` can be sent
again, and if no round has carried by the end of the judging period the bond
is released.

**The release.** A bond held until a round carries is a bond that can be held
for ever, if no round ever does. So from the end of the judging period, a day
after the reveal deadline and the same moment `close` opens to the researcher,
anyone may call `release_bond` on a response that is still waiting on a survey
whose pairs were revealed: the bond goes back to the respondent's credit, no
reward is paid, no verdict is recorded, and the status becomes `released`. It
asks no model, moves nothing out of the contract and reads one response. The
cost is that a contradictory response nobody judged in time keeps its bond;
the researcher, who is paid that bond, had the whole judging period to have it
judged. A response whose pairs were never revealed is refused and pointed to
`claim_unrevealed`, which pays the reward: a release there would let anybody
take a respondent's reward away.

## 7. Why every settlement is bounded, and no cap a stranger can fill

A settlement that walks a list of responses grows with the number of people who
answered, and past some count it no longer fits in a transaction.

**Pay as you go.** Each response is settled in its own call, `judge` or
`claim_unrevealed`, or released by `release_bond`: one round at most, one
response row, at most one transfer.
A test judges sixty responses, replaces the storage maps with maps that count
every read, and finds the sixty-first settlement reads exactly what the first
did. `close` reads two counters and no response.

**Every loop has a constant bound.** Three pairs, ten questions, a page of
twenty. A static test parses the file and fails on any loop that is not over
`range(n)` with `n` assigned once to a `min(...)` holding a module constant,
unless it reads the characters of one capped argument.

**No cap on responses.** Each response is bonded and one per address, and the
budget pays rewards first-judged-first, so nobody can close a survey by filling
it. The caps that remain are filled only by the researcher, in the survey
itself:

| cap | filled by | why nobody else can fill it |
|---|---|---|
| `MAX_QUESTIONS`, 10 questions | the researcher, at opening | it is the researcher's own survey |
| `MAX_PAIRS`, 3 pairs | the researcher, in the seal | only the researcher reveals |
| the budget, a whole number of rewards | consistent responses, first judged first | each is bonded and must give the same answer twice to every sealed pair |

The budget is the one a stranger can reach: a careful bot, or the researcher's
own second address, answering consistently is paid like anybody else. The
README states both as limits.

## 8. The doors

| rule | why |
|---|---|
| the researcher may not answer their own survey | they know the pairs; another address is still possible, and stated as a limit |
| one response per address, in any letter case | one answer per respondent, and no second try at a consistent set |
| responses only while the answer window is open, on the message clock | nobody answers after the pairs could be known |
| no verdict before the window closes | nobody learns a verdict while they could still answer again |
| the bond must be in credit | checked before anything is written |
| the pairs are revealed only by the researcher, once, between the windows | the seal opens once, after the answers are fixed |
| each response is judged once, whatever it was found | no reading is re-rolled until it suits |
| no judgment before the reveal; no unrevealed claim before the deadline or after a reveal | one route per response, chosen by what the researcher did |
| a survey closes once every response is settled, or a day after the reveal deadline | rewards cannot be taken back while responses are still being judged |
| a bond is released only from a day after the reveal deadline, only for a response nobody judged, only once the pairs were revealed | the researcher has the whole judging period to judge; a judged response keeps its verdict; an unrevealed one claims its reward instead |
| no readable clock, nothing recorded | every window is measured on the message clock, the same on every node |

**Every refused party has somewhere to go.** A respondent refused for want of
credit deposits and answers again; one refused at the door answers again in the
window; one read unclear withdraws the bond; one whose round stored nothing is
judged again, and if no round has carried by the end of the judging period
releases the bond; one whose researcher never reveals claims the reward. A
researcher refused an early close settles the responses and closes; one
refused a reveal for a wrong salt reveals with the right one; one who missed the
reveal deadline closes after the claims. Each of these is a journey in the
suite.

## 9. Views

Every view takes ids, small integers or an address. A Studio read fails once the
encoded call passes 256 bytes, so no view takes a text. `responses_of` pages at
20 and says the `total`; `survey` and `response` return at most ten questions
or answers.

## 10. Verified, and not verified

**Verified here, offline, with no network:** 393 tests, green. The round is
driven with a scripted model per node: every cell of the combine rule through a
judgment, a reader led by position, a reader led by which question comes first,
readers that affirm everything, deny everything or answer garbage, the reversed
numbers mapped back on one, two and three pairs, malformed list answers, one
validator outvoted, a majority in another world storing nothing, a validator
whose own rerun raises, a leader that raised, and a round no majority carried
writing nothing. 313 defences removed or inverted one at a time, none
surviving, each with the test that caught it named in `tests/MUTATIONS.md`.
`genvm-lint` 0.11.0 passes with exit code 0.

**Verified by construction, through static checks over the parsed source:**
every model call is written inside the one leader closure, four askings, one
for each pairing of the two framings with the two orders, combined through
`_combine`; there is one round, not nested, run only in `judge` after every
refusal and before every write; the validator is one line delegating to the
comparison, which refuses a leader error first and compares by exact equality;
every write either refuses by sender or is listed with its reason (`deposit`,
`open_survey`, `judge`, `claim_unrevealed`, `release_bond`); the payable writes reach no raise
and no round; the seal is checked in code before anything is written; the
delimiter is written in one place and carries the body's hash; every value
interpolated into a prompt is fenced or a contract constant; every `json.loads`
refuses floats; no float, no true division, no `datetime`; every loop is bounded
by a constant; storage holds scalars only; views take only short arguments; the
file pins the runner in its first line; no personal or internal detail appears
anywhere in the repository.

**Verified on chain:** not yet. The on-chain run is recorded in the README once
it has run.

**Not verified:** how a live model reads the demonstration, in particular
whether it reads "About 25 minutes" and "25" as the same amount, and "Depends"
and "It varies" as saying nothing rather than the same thing; whether a
respondent who pastes one specific answer into every question is read as
answering the questions or as repeating words; how often a borderline pair
splits across the four askings; and which model the validators run.
