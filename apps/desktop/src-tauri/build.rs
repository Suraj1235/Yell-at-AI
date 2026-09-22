// Build script: stage the product shell, then hand over to tauri-build.
//
// The desktop app has no frontend of its own. It runs `apps/shell/` - the same
// vanilla ES modules the web build serves - and the shell imports the analysis
// engine from `apps/web/vendor/` by relative URL (`../../web/vendor/...`).
//
// `frontendDist` cannot simply be `apps/`: Tauri embeds every file under it,
// and `apps/` contains this crate's own `target/` directory. So this script
// mirrors exactly the two trees the shell needs into `gen/frontend/`, keeping
// their relative layout so every import resolves unchanged:
//
//   gen/frontend/shell/**        <- apps/shell/**
//   gen/frontend/web/vendor/**   <- apps/web/vendor/**
//
// `gen/` is gitignored. This is a build artifact, not a second copy of the
// source: nothing is committed twice and there is nothing to keep in sync by
// hand. Files are only rewritten when their bytes change, so an unchanged tree
// does not keep invalidating the build, and files deleted upstream are
// removed from the stage.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const STAGE: &str = "gen/frontend";
const TREES: &[(&str, &str)] = &[("../../shell", "shell"), ("../../web/vendor", "web/vendor")];

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let stage = manifest.join(STAGE);

    for (source, target) in TREES {
        let from = manifest.join(source);
        println!("cargo:rerun-if-changed={}", from.display());
        if !from.is_dir() {
            panic!(
                "The desktop frontend is apps/shell plus apps/web/vendor, but {} does not exist. \
                 Build from a checkout (or an adapter bundle) that contains both.",
                from.display()
            );
        }
        let to = stage.join(target);
        mirror(&from, &to).unwrap_or_else(|error| {
            panic!("Could not stage {} into {}: {error}", from.display(), to.display())
        });
    }

    tauri_build::build();
}

/// Make `to` an exact copy of `from`, touching only what differs.
fn mirror(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;

    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let source = entry.path();
        let target = to.join(&name);
        if entry.file_type()?.is_dir() {
            mirror(&source, &target)?;
        } else {
            let bytes = fs::read(&source)?;
            if fs::read(&target).map(|existing| existing != bytes).unwrap_or(true) {
                fs::write(&target, bytes)?;
            }
        }
    }

    for entry in fs::read_dir(to)? {
        let entry = entry?;
        if !from.join(entry.file_name()).exists() {
            let stale = entry.path();
            if entry.file_type()?.is_dir() {
                fs::remove_dir_all(stale)?;
            } else {
                fs::remove_file(stale)?;
            }
        }
    }
    Ok(())
}
