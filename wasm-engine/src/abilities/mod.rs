//! Per-ability modules. New abilities live here, one file per ability family.
//! Existing `*_breath.rs` files are legacy names from the pre-composable era -
//! rename opportunistically when touched. Policy: new abilities → new file
//! here, not composable.rs.

pub(crate) mod rewind_breath;
