// Bespoke contour tests (simple_melee, status_melee, active_melee, life_leech_melee,
// and 12 breath contours) were deleted on 2026-04-10 together with the bespoke
// contour functions themselves.
//
// The composable engine has its own parity test suite inside composable.rs:
//   composable::tests::composable_matches_breath_rs_on_fixture_data
//   composable::tests::composable_matches_status_melee_on_fixture_data
//   composable::tests::composable_matches_active_melee_on_fixture_data
//   composable::tests::composable_matches_life_leech_melee_on_fixture_data
// plus smaller unit tests for each ability module.
//
// This file used to be ~8,000 lines of tests pinned to the bespoke contours.
// Keeping it as a stub so `#[cfg(test)] mod tests;` in lib.rs still resolves.
