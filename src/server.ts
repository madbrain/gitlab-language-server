import {
  createConnection,
  Connection,
  ProposedFeatures,
} from "vscode-languageserver/node";
import {
  TextDocuments,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  Diagnostic,
  Range,
  DiagnosticSeverity,
  CompletionList,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getGitlabDocument } from "./documentCache";
import { ValidationDebouncer } from "./validationDebounce";
import { ErrorReporter, NullReporter } from "./lang/error-reporter";
import { Range as InternalRange } from "./lang/generic-model";

let connection: Connection =
  process.argv.indexOf("--stdio") === -1
    ? createConnection(ProposedFeatures.all)
    : createConnection();

process.on("uncaughtException", (err: Error) => {
  connection.console.error(`${err.name} ${err.message}`);
});

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

documents.listen(connection);

const validationDebouncer = new ValidationDebouncer(500, validateTextDocument);

connection.onInitialize((params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {},
      workspace: {
        workspaceFolders: {
          supported: true,
        },
      },
    },
  };
});

connection.onInitialized(() => {
  documents.onDidChangeContent((change) => {
    validationDebouncer.validate(change.document);
  });
  documents.onDidClose((event) => {
    validationDebouncer.cleanPendingValidation(event.document);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  });
});

connection.onCompletion((params) => {
  const document = documents.get(params.textDocument.uri);
  if (document) {
    const position = document.offsetAt(params.position);
    const gitlabFile = getGitlabDocument(document, NullReporter);
    connection.console.info(
      `complete ${params.textDocument.uri} at ${position}`,
    );
    // gitlabFile?.jobs.forEach((job) => {
    //   if (job.stage?.range) {
    //     // TODO
    //   }
    // });
  }
  return { isIncomplete: false, items: [] };
});

function validateTextDocument(textDocument: TextDocument) {
  if (!textDocument) {
    return;
  }

  function makeRange(range: InternalRange) {
    return Range.create(
      textDocument.positionAt(range.start),
      textDocument.positionAt(range.end),
    );
  }

  const diagnostics: Diagnostic[] = [];
  const reporter: ErrorReporter = {
    reportError(range: InternalRange, message: string) {
      diagnostics.push(
        Diagnostic.create(
          makeRange(range),
          message,
          DiagnosticSeverity.Error,
          "001",
          "gitlab",
        ),
      );
    },
    reportWarning(range: InternalRange, message: string) {
      diagnostics.push(
        Diagnostic.create(
          makeRange(range),
          message,
          DiagnosticSeverity.Warning,
          "001",
          "gitlab",
        ),
      );
    },
  };

  connection.console.info(`validate ${textDocument.uri}`);

  const gitlabDocument = getGitlabDocument(textDocument, reporter);

  connection.sendDiagnostics({
    uri: textDocument.uri,
    diagnostics,
  });
}

connection.listen();
