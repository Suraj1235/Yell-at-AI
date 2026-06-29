-- Subtext global hotkey bridge for Hammerspoon.
-- Default binding: cmd+alt+ctrl+y

local node = os.getenv("SUBTEXT_NODE") or "node"
local subtext_cli = os.getenv("SUBTEXT_CLI_PATH") or "bin/subtext.js"
local transcript_command = os.getenv("SUBTEXT_TRANSCRIPT_COMMAND") or "host-transcript --json {audio}"
local duration = os.getenv("SUBTEXT_DURATION") or "4"
local target = os.getenv("SUBTEXT_TARGET") or "paste"

local function shell_quote(value)
  local text = tostring(value)
  return "'" .. text:gsub("'", "'\\''") .. "'"
end

local function run_subtext_turn()
  local command = table.concat({
    shell_quote(node),
    shell_quote(subtext_cli),
    "ptt",
    "--turns", "1",
    "--trigger", "none",
    "--duration", shell_quote(duration),
    "--transcript-command", shell_quote(transcript_command),
    "--target", shell_quote(target)
  }, " ")

  hs.alert.show("Subtext listening")
  hs.task.new("/bin/sh", function(exit_code, stdout, stderr)
    if exit_code == 0 then
      hs.alert.show("Subtext prompt delivered")
    else
      hs.alert.show("Subtext failed")
      print(stderr or stdout or ("subtext exited " .. tostring(exit_code)))
    end
  end, { "-lc", command }):start()
end

hs.hotkey.bind({ "cmd", "alt", "ctrl" }, "Y", run_subtext_turn)
