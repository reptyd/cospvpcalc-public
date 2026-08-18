# Reference style

`src/pages/referenceContent.ts` is both the spec the Rust engine is tested
against and the player-facing mechanic documentation. Entries should read
naturally, and every `mechanics` / `policyDifferences` bullet should map to a
test.

## The register

**Strict mathematical prose.** Every rule below follows from that, and where one
of them appears to permit a sentence the register does not, the register
decides. Read this section before writing, and again before calling a batch
done. A neighbouring entry is not the authority: the file is being corrected, so
copying an entry copies whatever in it has not been corrected yet.

A sentence states one thing that is either true or false, and states it exactly
enough that a reader can go and check. A condition is named: *applies during
Winter and Famine*, never *needs the right conditions to have arrived*. A set is
listed: *applied by Cause Fear and Spirit Glare*, never *and some other
abilities*. A quantity is a number. Where a rounded figure is easier to read,
the exact figure is written beside it.

**No metaphor, and no figure of speech.** An effect applies, costs, lasts, or is
computed from something. It does not `pay out`, `buy`, `ride on`, `dilute`, be
`worth` anything, go `deep`, leave a convention `homeless`, or `walk past` a
rule. A reader should not have to convert an image back into the mechanic, and a
writer who writes an image has stopped stating what is true. This rule is broken
more often than any other, and it is broken by writers who have just quoted a
different one: it was written into an entry, into review documents, into commit
subjects and into answers to the owner, in the same hours as the passes that
were enforcing this page.

**The register binds every written text outside `docs/internal/`.** Not this file
alone: the interface strings, the code comments, the guides in `docs/`, the four
public documents, and the commit messages. Anything a reader of the public project
can open is bound by it. `docs/internal/dev_log_style_guide.md` §3 states the same
register and binds it to every artifact handed to the owner - candidate lists,
notes and questions as much as a finished text. Six of the sentences that broke
it in the last two days were outside this file, not in the entries.

Where precision and plain words disagree, precision decides. `pseudo-crit` is
the name for a crit chance included in a flat multiplier, and *chance effects*
is the shorter phrase for the same thing and the wrong one.

Nothing is written to prepare, to soften, to connect, or to state again what the
sentence before it stated. A reader who has just read the neighbouring bullet
has already been told.

## Writing the bullets

These rules bind `gameTruth`, `currentApproximation` and `whyApproximated` on an
approximation entry, and `whyItsNotModeledHere` on an ability entry, as they
bind `mechanics`. `whyApproximated` and `whyItsNotModeledHere` keep the
exemption stated for them under **Describe the mechanic as this calculator
recreates it**.

- `summary` is one sentence naming what this object does. It is not the
  `status` field written out (`Battle setting.`) and not a copy of the first
  bullet. Two objects the model treats the same way get the same summary, and
  that is the honest answer rather than a failure: Rod and Magichorn Prongbug
  are one 10% health-regeneration multiplier, Mylo and Succulant one 2.5%
  multiplier on the same five speed channels, and the difference between each
  pair - whether a second copy can be equipped - is a mechanics bullet in both.
  This page used to require a summary that would not fit the entry beside it.
  That requirement produced a clause appended to Rod's and Mylo's summaries that
  restated the bullet below, a roster comparison in Refreshed's that another
  rule here forbids, and nine battle settings whose whole content is two
  figures and for which there was nothing else to state.
- One atomic, testable claim per bullet. Two facts joined with "and" are split
  into two bullets. A second sentence that qualifies the first is allowed; one
  that restates the first negated is the same claim written twice.
- A gate says what the creature must be, in the words the maths uses: `The
  creature must own Speed Steal.`, `The creature carrying it must be tier 1 or
  2.` Do not write that a creature can or cannot *hold* an effect unless that is
  what the gate does. Momo can be equipped on any creature; a non-herbivore that
  carries it gets an effect that resolves to nothing, and `Only a creature with
  a herbivore diet can hold it` states the opposite of the code.
- Third person with fixed roles: *the user* owns the ability, *the target* is
  a specific recipient, *the opponent* is the generic other side, *the
  attacker* is whoever bit (in a defensive context), *the affected creature*
  bears a status. Not "you", not "the caster", not "the player".
- Present tense and declarative. Spell words out - `does not`, not `doesn't`.
- Numbers: `X seconds`, `5%` (no space); use `×` in inline formulas and define
  each variable next to it.
- A multiplier named as a value takes `x` - `a 1.2x buff`, `gives 1.5x stacks`.
  After the verb it does not: `multiplied by 1.2`, not `multiplied by 1.2x`.
- A quantity added to a percentage is `N percentage points`, never `N%`. The
  two are different numbers and `%` reads as the relative one.
- Statuses: the in-game TitleCase display name (`Bleed`, `Bad Omen`), never
  the engine id (`Bleed_Status`). Write `N stacks of <Status>` (`stack of`
  for exactly one).

## Which facts are written

Every bullet costs the reader the time to read it. The reader is opening the
site for the first time and plays the game already, so most of what could be
stated is either something the reader knows already or something the entry
beside it states.

This section addresses the reader of the site, who has no repository history. A
guide may state the history a contributor needs, written in the register.

- **The reader has no earlier version of this calculator.** No sentence compares
  the present one against an earlier one - no `(was: …)`, no "used to", no "the
  setting is gone". A creature that can no longer dodge is a different case:
  that is a state inside one fight, and it belongs.
- **A mechanic covered by a test is the register to write in.**
  `reference_tests/` checks those bullets against an exact number, which is most
  of why they read the way they do.
- **An extra fact is not written by default.** An explanation is written only
  where the reader could not have reached the fact alone, and what a reader can
  reach alone is judged from the game the reader plays. *A full bar does not
  empty in a fight of normal length* is true and states nothing the reader
  lacks; the reader has played a fight.
- **Absence is the default.** An effect that is not mentioned reads as missing,
  so a sentence stating that a mechanic does not do something is written only
  where the effect itself would lead a reader to expect the opposite. Weight
  scaling and stacking are common enough that denying them is written; that a
  swimmer does not change flight speed is not.
- **A field does the job it is for.** `whyApproximated` holds the reason and may
  state it in terms of the model, which is what the field is about;
  `currentApproximation` holds the consequence. A reason that states the
  consequence again repeats its neighbour, and
  `referenceFieldOverlap.test.ts` counts the words the two share.

## The words

The game has a word for each of these and so does the file. Use them. A
synonym reads as a second mechanic - "Defensive falls away once the creature
strays too far" leads a reader to ask how falling away differs from decaying,
and it does not differ.

A status **lands** on a creature. It carries **stacks**. It **decays** - its
stack count falls on a schedule. Its **expiry** is the moment its last stack is
removed, and where an on-removal effect fires, it fires there. Something else
can **cleanse** it early, or **block** it before it lands at all. A repeating
effect **ticks**. A status does not fade, wear off, fall away, drop off or run
out. Self-Destruct is the case to watch: its fuse is a status as well, and the
explosion fires at the fuse's expiry.

An ability **fires**; while it cannot fire again it is on **cooldown**. A
**bite** lands or misses, and its **bite cooldown** is the interval before the
next one. A **breath** fires while it has **capacity**, and the capacity
**refills**.

`status` and `ailment` are both right and both in use - 90 against 79, counting
either word and its plural inside the entries' own strings. Neither has to be
defended, and an entry is not required to change the one it uses. What does not
belong is the game's `Value` for a stack count: that is a field name, and the
rule against the game's internals covers it.

## mechanics vs notes

`mechanics` are testable claims; `notes` are non-testable context (combat-log
mentions, modeling caveats). If something in `notes` could be tested, move it
to `mechanics`.

A bullet is pinned to the code in several places, and some of those pins do not
detect a rewrite. A `specConstants` `quote` is checked as a verbatim substring
by codegen, so rewording that run fails the build. A Rust test that quotes the
bullet in a `// Bullet N: "…"` comment is bound to it by
`referenceBulletQuote.test.ts`, which fails naming the file, the number and both
texts; the fix is always the comment, never the entry. The Speed Builds oracle
is the pin to check: it matches sentence shapes with regexes, so a rewrite it no
longer matches checks less than it did, and nothing reports that.
And a quote written without that `Bullet N:` marker - the marker, then the
quoted run on the next line - is bound to nothing at all: 38 runs are written
that way, in `policy/tests/reference_entries.rs` and in fourteen files of
`reference_tests/` itself, and around twenty of them no longer state what the
entry states.

A plushie entry is pinned by none of those. `specConstants` does not exist on
that type, no test quotes a plushie bullet, and the Speed Builds oracle takes
only the names. What pins it is `src/engine/plushieReference.test.ts`, which
joins the entry's summary, mechanics and notes and searches for the words
`unique` and `stackable` - so the stack rule is pinned through a word in the
prose, and an entry that contains neither word is never checked at all. Eclipse
contained neither until `1e02e8d4`, so the entry the data calls stackable went
unchecked from the day the test was written.

Before rewriting a bullet, search the engine for its text rather than working
through a list. This paragraph named three places until a fourth was found, and
a rule that enumerates its places tells the reader that the enumeration is
complete.

Refer to another entry by display name, and by section where the name alone
would not find it - `See Stubborn Stacker.`, `See Cower in Movement Speed.` -
never by `id`. A number derived in one entry is derived there once, and the
other entries refer to it.

Do not document a mechanic that no code implements. Stamina is the standing
example: it is not modeled anywhere and a partial model would be worse than
none. Movement was listed here and is not now - Speed Builds models it, and an
entry whose movement side has no Movement Speed entry of its own carries
`movesSpeed` so the object is present in that section.

`status` says where the object is modeled, so pick the narrowest one that is
true. An object whose only modeled side is a movement channel is
`Speed-Builds-only`, not `Out of model` - Mylo, Speed Blitz, Tail Drop, Agile
Swimmer. `Out of model` is for objects nothing computes anything from.

That field is the only source for the coverage label and for the coloured
ability list in Compare (`REFERENCE_ABILITY_SCOPE` derives both), so changing
it changes what a reader is told everywhere at once.

## Out of model vs not planned

An object outside the model gets one of two statuses, and the choice is whether
the absence needs an explanation.

`Out of model` is the default and needs no explanation: nothing about the
object reaches a number the calculator produces. All 35 use the
`createOutOfModelAbilityEntry(name)` helper and share its wording. The
uniqueness rule above does not apply to them - a separate sentence per entry
would state the same thing thirty-five times, and the shared summary is the
honest answer. Do not write bespoke mechanics for them either: the helper's own
single bullet is the whole claim, and it is what
`src/optimizer/outOfModelAbilities.test.ts` verifies for every one of them at
once. Add the name to the helper's call list and nothing else.

`Not planned` is for the few where a reader would reasonably expect the
mechanic to be here and would ask why it is not. Those carry
`whyItsNotModeledHere` with the actual reason, stated in terms of the fight -
Silly Beam is not modeled because its effect is highly random, and averaging
the statuses it can land would produce a beam that matches nothing the game
does. Use this status only where there is such a reason; "we have not got to
it" is `Out of model`.

## Describe the mechanic as this calculator recreates it

The subject is not the game on its own terms. It is our version of the game -
the mechanic as the model runs it, including the places we simplify. Where a
concession exists, the entry names it; a reader comparing our number against
the live game needs to know which parts we chose.

Some entries have no game side at all. Ability policies are ours - a real
player decides when to press an ability, and a policy is how the model decides
in their place. Battle settings and the Speed Builds search are the same.
For those, our mechanism is the whole subject, and naming it is naming the
subject rather than describing a control.

What is excluded. All of it applies to every field a reader sees - `name`,
`summary`, `mechanics`, `policyDifferences`, `notes`, and the approximation
fields. A phrase that does not belong in a `mechanics` bullet does not belong in
a `summary` either.

- The interface: `the page`, `this page`, `the reader`, `the ranking`, `the
  sweep`, `the registry`, `is offered`. How a control is operated is not a
  mechanic.
- Why a product decision was made: `because nobody else can meet it`, `would be
  worse`. A modelling concession is the subject; a justification for a UI choice
  is not.
- Comparisons and counts of our own data: `the largest buff in the game`,
  `30 of the roster`, `86% of them`.
- The game's internals: field names, `OnGet`, `AilmentTargets`, dead branches.
  State the observable effect. The reason does not move into a code comment
  either: comments ship in this repository and are bound by the same rule, so a
  comment states what the game does and never where that was read.
- Our own internals, the same way: where a check sits, which function every
  path runs through, what the engine "recognises". `The block sits on the one
  point where any status is applied` says where our code put an `if`; a reader
  needs what lands and what does not. Check for this one, because a writer can
  write it while intending to be thorough.
- The rest of an ability, where the only modeled side is a movement channel.
  `Speed-Builds-only` means one multiplier is carried and nothing else is; a
  duration, a cooldown, a health cost or a status it leaves behind are the game
  describing itself. Listing them as things we do not carry is the same
  sentence in negative form - `no duration or cooldown is carried` names them
  as well.
- Any wording that treats the game's code as something an entry can consult -
  `server-side`, `not in the dump`, `not observable in the client`, `a delay it
  cannot read`. Where a number could not be determined exactly, state that it
  was measured or chosen: `1.5 seconds, the average we measured`, not `the real
  value is somewhere we cannot look`.

Six of the rules above were once patterns in a test that read this file as
text - the game's code treated as consultable, our own internals, a status
ending in a synonym for decay or expiry, a sentence written from an earlier
state of the calculator, a condition or a set left unnamed, and the figures of
speech. That test has been deleted. It matched nothing across the 46 commits in
which it existed, because every pattern was added in the same commit that
cleaned by hand the text the pattern named, and a phrase one word away from a
pattern did not match it. It also replaced the rule in practice: reviews cited
the regex instead of this page, and a defect planted to test a reviewer was
copied out of the regex's own examples, so the probe measured pattern-matching
rather than reading.

These rules are read, and a reader who has just read them is the check. Nothing
here is enforced by a machine and nothing here should be.

Two fields exist to hold a reason and are not bound by that first bullet:
`whyApproximated` says why we simplified, `whyItsNotModeledHere` says why we
did not model at all. Give the reason in terms of the fight or the model, not
in terms of the interface - `full alternation would need randomness, and a
build score has to be repeatable` rather than `it would break the ranking`.

Split by testability, not by subject: `mechanics` holds what a test could
check, `notes` the context around it. "In Compare..." is the usual opening of a
note, but it does not decide the field: a testable claim that opens that way
is still a mechanic, and a note is a note because nothing could check it.

Stamina does not appear at all. Nothing here reads it, so a note reporting an
in-game stamina figure tells a reader about a system this calculator does not
have - which is the game describing itself. Leave the effect's stamina side
out, do not state that it was left out, and do not list stamina among the things
the model lacks. When stamina is modeled one day, its entries get written then.

## Timing policies

An ability's `policyDifferences` describe the five timing modes - `really
fast`, `fast`, `semi-ideal`, `ideal`, `extreme` - grouping modes that behave
the same. Name all five when saying they agree; a list of four reads as an
omission. If an ability has no policy-dependent behavior, say so in one line.

The field stays empty where no timing policy runs at all: abilities no fight
reaches, and battle settings with no decision of their own. Nothing decides
them, so there is no difference to describe.

A rule that runs its own mode set instead of the five - Secondary Attack's
Primary / Dynamic / Secondary, the Sit/Lay/Stand policy's Off / Auto
Regen-aware / Auto Regen-unaware - puts that set here. It is still a decision
the model makes in a player's place, which is what the field is for.

The mode names are ordinary words: lowercase inside a sentence, capitalized
only where the sentence starts or where one is an entry's `name`.

## Bookkeeping

- Entries are alphabetical by `name` within each array.
- `id` is stable: pick it once and never change it - tests bind to it.
- Reference, code, and observed game behavior must agree. When they diverge,
  raise it with the maintainer rather than guessing.
