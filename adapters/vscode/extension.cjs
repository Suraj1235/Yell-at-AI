const vscode = require("vscode");
const { dirname } = require("node:path");
const { buildHandoffArgs, resolveCliPath, runSubtextHandoff } = require("./runner.cjs");

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("subtext.copyEnrichedPrompt", () => runCommand(context, "copy")),
    vscode.commands.registerCommand("subtext.insertEnrichedPrompt", () => runCommand(context, "insert")),
    vscode.commands.registerCommand("subtext.previewEnrichedPrompt", () => runCommand(context, "preview"))
  );
}

function deactivate() {}

async function runCommand(context, mode) {
  try {
    const options = await collectOptions(context);
    if (!options) return;

    const output = await runSubtextHandoff(options);
    if (mode === "copy") {
      await vscode.env.clipboard.writeText(output);
      vscode.window.showInformationMessage("Subtext enriched prompt copied.");
    } else if (mode === "insert") {
      await insertIntoActiveEditor(output);
      vscode.window.showInformationMessage("Subtext enriched prompt inserted.");
    } else {
      await previewOutput(output);
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Subtext failed: ${error.message}`);
  }
}

async function collectOptions(context) {
  const config = vscode.workspace.getConfiguration("subtext");
  const cliPath = resolveCliPath(config.get("cliPath"), context.extensionPath);
  const baselinePath = config.get("baselinePath") || "";
  const verbosity = config.get("defaultVerbosity") || "full";
  const audioPath = await pickWavFile();
  if (!audioPath) return null;

  const text = await vscode.window.showInputBox({
    title: "Subtext transcript",
    prompt: "Paste or type the transcript for this audio turn.",
    ignoreFocusOut: true
  });
  if (!text) return null;

  return {
    cliPath,
    audioPath,
    ...transcriptInputFromText(text),
    baselinePath,
    verbosity,
    cwd: dirname(cliPath)
  };
}

function transcriptInputFromText(value) {
  const text = String(value ?? "").trim();
  if (!text.startsWith("{")) return { text };

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed.text || parsed.transcript)) {
      return { transcript: parsed };
    }
  } catch {
    return { text };
  }

  return { text };
}

async function pickWavFile() {
  const selection = await vscode.window.showOpenDialog({
    title: "Choose a WAV file for Subtext",
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      WAV: ["wav"]
    }
  });

  return selection?.[0]?.fsPath ?? null;
}

async function insertIntoActiveEditor(text) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.env.clipboard.writeText(text);
    throw new Error("No active editor. Enriched prompt copied to clipboard instead.");
  }

  await editor.edit((builder) => {
    for (const selection of editor.selections) {
      builder.replace(selection, text);
    }
  });
}

async function previewOutput(text) {
  const document = await vscode.workspace.openTextDocument({
    content: text,
    language: "plaintext"
  });
  await vscode.window.showTextDocument(document, { preview: false });
}

module.exports = {
  activate,
  deactivate,
  _test: {
    buildHandoffArgs,
    collectOptions,
    insertIntoActiveEditor,
    pickWavFile,
    previewOutput,
    resolveCliPath,
    runSubtextHandoff,
    transcriptInputFromText
  }
};
