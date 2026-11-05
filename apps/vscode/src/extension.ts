import * as vscode from "vscode";
import { formatText, IngestError, scanFolder, scanZip, type ScanReport } from "@repo-safety/core";
import { notification, statusText, toDiagnosticSpecs } from "./present.js";

let diagnostics: vscode.DiagnosticCollection;
let status: vscode.StatusBarItem;
let output: vscode.OutputChannel;
let lastReports: ScanReport[] = [];

const LEVELS = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
};

export function activate(context: vscode.ExtensionContext) {
  diagnostics = vscode.languages.createDiagnosticCollection("repo-safety");
  output = vscode.window.createOutputChannel("Repo-Safety");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "repoSafety.showReport";
  context.subscriptions.push(diagnostics, output, status);

  context.subscriptions.push(
    vscode.commands.registerCommand("repoSafety.scanWorkspace", () => scanWorkspace(true)),
    vscode.commands.registerCommand("repoSafety.showReport", showReport),
    vscode.commands.registerCommand("repoSafety.scanFolder", async () => {
      const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: "Scan folder" });
      if (picked?.[0]) await scanExternal(picked[0], "folder");
    }),
    vscode.commands.registerCommand("repoSafety.scanZip", async () => {
      const picked = await vscode.window.showOpenDialog({ canSelectFiles: true, filters: { "ZIP archives": ["zip"] }, openLabel: "Scan ZIP" });
      if (picked?.[0]) await scanExternal(picked[0], "zip");
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => scanWorkspace(false)),
  );

  const mode = vscode.workspace.getConfiguration("repoSafety").get<string>("scanOnOpen", "untrusted");
  if (mode === "always" || (mode === "untrusted" && !vscode.workspace.isTrusted)) {
    void scanWorkspace(false);
  }
}

export function deactivate() {}

/** Scan every workspace folder. Reading files only: nothing from the folder is executed. */
async function scanWorkspace(userRequested: boolean) {
  const folders = vscode.workspace.workspaceFolders?.filter((f) => f.uri.scheme === "file") ?? [];
  if (folders.length === 0) {
    if (userRequested) void vscode.window.showInformationMessage("Repo-Safety: open a folder first, or use \"Scan a Folder Without Opening It\".");
    return;
  }

  setStatus("scanning");
  diagnostics.clear();
  lastReports = [];
  try {
    for (const folder of folders) {
      const report = await scanFolder(folder.uri.fsPath, { label: folder.name });
      lastReports.push(report);
      applyDiagnostics(folder.uri, report);
    }
  } catch (err) {
    setStatus("error");
    output.appendLine(`Scan failed: ${(err as Error).message}`);
    if (userRequested) void vscode.window.showErrorMessage(`Repo-Safety: ${(err as Error).message}`);
    return;
  }

  const worst = lastReports.find((r) => r.verdict === "dangerous") ?? lastReports.find((r) => r.verdict === "suspicious") ?? lastReports[0]!;
  setStatus(worst.verdict);
  writeOutput();

  const note = notification(worst, vscode.workspace.isTrusted);
  if (note) {
    const show = note.kind === "error" ? vscode.window.showErrorMessage : vscode.window.showWarningMessage;
    const actions = ["Show findings", "Full report"];
    const choice = await show(note.message, { modal: note.kind === "error" && !vscode.workspace.isTrusted }, ...actions);
    if (choice === "Show findings") void vscode.commands.executeCommand("workbench.actions.view.problems");
    if (choice === "Full report") showReport();
  } else if (userRequested) {
    void vscode.window.showInformationMessage("Repo-Safety: no known traps found. This lowers risk but can't guarantee safety.");
  }
}

/** Scan a folder or ZIP that is NOT open, so nothing in it can run before you decide. */
async function scanExternal(uri: vscode.Uri, kind: "folder" | "zip") {
  try {
    const report = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Repo-Safety: scanning ${uri.fsPath}` },
      () => (kind === "folder" ? scanFolder(uri.fsPath) : scanZip(uri.fsPath)),
    );
    lastReports = [report];
    writeOutput();
    output.show(true);
    const note = notification(report, false);
    if (note) void (note.kind === "error" ? vscode.window.showErrorMessage(note.message) : vscode.window.showWarningMessage(note.message));
    else void vscode.window.showInformationMessage("Repo-Safety: no known traps found. This lowers risk but can't guarantee safety.");
  } catch (err) {
    const msg = err instanceof IngestError ? `Rejected: ${err.message}` : (err as Error).message;
    void vscode.window.showErrorMessage(`Repo-Safety: ${msg}`);
  }
}

function applyDiagnostics(root: vscode.Uri, report: ScanReport) {
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const spec of toDiagnosticSpecs(report)) {
    const d = new vscode.Diagnostic(new vscode.Range(spec.line, 0, spec.line, Number.MAX_SAFE_INTEGER), spec.message, LEVELS[spec.level]);
    d.source = "Repo-Safety";
    d.code = spec.code;
    const list = byFile.get(spec.file) ?? [];
    list.push(d);
    byFile.set(spec.file, list);
  }
  for (const [file, list] of byFile) diagnostics.set(vscode.Uri.joinPath(root, ...file.split("/")), list);
}

function setStatus(v: Parameters<typeof statusText>[0]) {
  const s = statusText(v);
  status.text = s.text;
  status.tooltip = s.tooltip;
  status.backgroundColor = v === "dangerous" ? new vscode.ThemeColor("statusBarItem.errorBackground") : v === "suspicious" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
  status.show();
}

function writeOutput() {
  output.clear();
  for (const r of lastReports) {
    output.appendLine(formatText(r));
    output.appendLine("");
  }
}

function showReport() {
  if (lastReports.length === 0) {
    void vscode.commands.executeCommand("repoSafety.scanWorkspace");
    return;
  }
  output.show(true);
}
