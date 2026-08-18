//! Config-reader guard - class-2 of the schema seam.
//!
//! A `ComposableAbilityConfig` field can be added, mirrored in the TS bridge, and
//! threaded all the way to the engine, yet never actually *read* by any phase or
//! decision - leaving the ability silently inert (the engine deserializes the
//! flag and ignores it). Nothing else catches that.
//!
//! This walks the engine source and asserts every config field ident appears,
//! word-bounded, somewhere in the combat logic. It is self-maintaining: a new
//! field is checked automatically, so it adds no per-field chore to "add a field"
//! (unlike a hand-maintained reader table). The corpus excludes the struct
//! definition (`config.rs`) and the sandbox setter/getter table (`sandbox.rs`),
//! which mechanically name every field and would mask a genuinely-inert one.
//!
//! Limit: a field read into a local that is then logically unused still passes
//! (no static tool short of data-flow can see that). It catches the common,
//! concrete case - a flag nothing references at all.

use std::fs;
use std::path::Path;

const SRC_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
const CONFIG_RS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/composable/config.rs");

/// Config fields intentionally not referenced by combat logic. Each needs a
/// reason; the goal is an empty list.
const ALLOW_UNREAD: &[(&str, &str)] = &[];

/// `pub <ident>:` field names of `ComposableAbilityConfig` (the struct has no
/// nested object literals, so a flat scan of its body is exact).
fn config_field_idents() -> Vec<String> {
    let src = fs::read_to_string(CONFIG_RS).expect("read config.rs");
    let marker = "pub struct ComposableAbilityConfig {";
    let start = src.find(marker).expect("ComposableAbilityConfig struct present");
    let open = start + src[start..].find('{').unwrap();
    let mut depth = 0;
    let mut end = src.len();
    for (i, ch) in src[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    end = open + i;
                    break;
                }
            }
            _ => {}
        }
    }
    let mut fields = Vec::new();
    for line in src[open + 1..end].lines() {
        if let Some(rest) = line.trim().strip_prefix("pub ") {
            if let Some(colon) = rest.find(':') {
                let ident = rest[..colon].trim();
                if !ident.is_empty() && ident.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                    fields.push(ident.to_string());
                }
            }
        }
    }
    fields
}

fn is_excluded(file_name: &str) -> bool {
    matches!(
        file_name,
        "config.rs"
            | "sandbox.rs"
            | "contract_manifest.rs"
            | "contract_readers.rs"
            | "fixture_tests.rs"
            | "compare_fixture_tests.rs"
            | "contour_bench.rs"
            | "tests.rs"
    ) || file_name.ends_with("_tests.rs")
}

fn collect_engine_sources(dir: &Path, out: &mut String) {
    for entry in fs::read_dir(dir).expect("read_dir engine src") {
        let path = entry.expect("dir entry").path();
        if path.is_dir() {
            if path.file_name().is_some_and(|n| n == "reference_tests") {
                continue;
            }
            collect_engine_sources(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            let name = path.file_name().unwrap().to_string_lossy();
            if is_excluded(&name) {
                continue;
            }
            out.push_str(&fs::read_to_string(&path).expect("read engine rs"));
            out.push('\n');
        }
    }
}

/// `\b<ident>\b` - `ident` as a whole token (neighbours are not `[A-Za-z0-9_]`),
/// so `attacker_totem` does not match inside `attacker_totem_status_id`.
fn is_referenced(haystack: &str, ident: &str) -> bool {
    let bytes = haystack.as_bytes();
    let word = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let mut from = 0;
    while let Some(rel) = haystack[from..].find(ident) {
        let at = from + rel;
        let before_ok = at == 0 || !word(bytes[at - 1]);
        let after_idx = at + ident.len();
        let after_ok = after_idx >= bytes.len() || !word(bytes[after_idx]);
        if before_ok && after_ok {
            return true;
        }
        from = at + 1;
    }
    false
}

#[test]
fn every_config_field_is_read_by_engine_logic() {
    let idents = config_field_idents();
    assert!(
        idents.len() > 100,
        "sanity check: parsed only {} ComposableAbilityConfig fields",
        idents.len()
    );
    let mut sources = String::new();
    collect_engine_sources(Path::new(SRC_DIR), &mut sources);

    let allowed: std::collections::HashSet<&str> =
        ALLOW_UNREAD.iter().map(|(name, _)| *name).collect();
    let unread: Vec<&String> = idents
        .iter()
        .filter(|f| !allowed.contains(f.as_str()) && !is_referenced(&sources, f))
        .collect();

    assert!(
        unread.is_empty(),
        "ComposableAbilityConfig fields never referenced by engine combat logic \
         (added to the config but no phase/decision reads them → silently inert): {unread:?}. \
         Wire the read in the consuming phase, or — if intentionally inert — add the field \
         to ALLOW_UNREAD with a reason."
    );
}
