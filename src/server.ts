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
  Location,
  CompletionItem,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { GitlabDocumentCache } from "./documentCache";
import { ValidationDebouncer } from "./validationDebounce";
import { ErrorReporter, NullReporter } from "./lang/error-reporter";
import { Range as InternalRange } from "./lang/generic-model";
import { CompletionPositioner } from "./lang/completion-positioner";
import { GenericTextDocument } from "./lang/text-document";
import { DefaultIncludeResolver, GitlabService } from "./lang/gitlabci";

let connection: Connection =
  process.argv.indexOf("--stdio") === -1
    ? createConnection(ProposedFeatures.all)
    : createConnection();

process.on("uncaughtException", (err: Error) => {
  connection.console.error(`${err.name} ${err.message}`);
});

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

documents.listen(connection);

const logConsole = {
  log: (msg: string) => connection.console.log(msg),
};
const includeResolver = new DefaultIncludeResolver(logConsole);
const gitlabService = new GitlabService(includeResolver);
const gitlabDocumentCache = new GitlabDocumentCache(gitlabService);
const validationDebouncer = new ValidationDebouncer(500, validateTextDocument);

connection.onInitialize((params: InitializeParams): InitializeResult => {
  if (params.workspaceFolders) {
    includeResolver.setWorkspaces(
      params.workspaceFolders.map((workspaceFolder) => workspaceFolder.uri),
    );
  }
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {},
      definitionProvider: {},
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

function adaptDocument(document: TextDocument) {
  return {
    uri: document.uri,
    makeRange: (range: InternalRange) => {
      return {
        start: document.positionAt(range.start),
        end: document.positionAt(range.start),
      };
    },
  };
}

connection.onCompletion(async (params) => {
  const document = documents.get(params.textDocument.uri);
  const items: CompletionItem[] = [];
  if (document) {
    const position = document.offsetAt(params.position);
    const cachedEntry = await gitlabDocumentCache.get(document, NullReporter);
    if (cachedEntry && cachedEntry.content && cachedEntry.model) {
      const documentPosition = new CompletionPositioner(
        new GenericTextDocument(document.getText()),
      ).findAtPosition(cachedEntry.content, position);
      if (documentPosition) {
        connection.console.log(
          `COMPLETE AT ${JSON.stringify(documentPosition)}`,
        );
        items.push(
          ...cachedEntry.model.mainFile.completeAt({
            document: adaptDocument(document),
            context: cachedEntry.model,
            position: documentPosition,
          }),
        );
      }
    }
  }
  return { isIncomplete: false, items };
});

connection.onDefinition(async (params) => {
  const document = documents.get(params.textDocument.uri);
  const locations: Location[] = [];
  if (document) {
    const position = document.offsetAt(params.position);
    const cachedEntry = await gitlabDocumentCache.get(document, NullReporter);
    if (cachedEntry && cachedEntry.content && cachedEntry.model) {
      const documentPosition = new CompletionPositioner(
        new GenericTextDocument(document.getText()),
      ).findAtPosition(cachedEntry.content, position);
      if (documentPosition) {
        connection.console.log(
          `GOTO DEFINITION ${JSON.stringify(documentPosition)}`,
        );
        locations.push(
          ...cachedEntry.model.mainFile.gotoDefinitionAt({
            document: adaptDocument(document),
            context: cachedEntry.model,
            position: documentPosition,
          }),
        );
      }
    }
  }
  return locations;
});

async function validateTextDocument(textDocument: TextDocument) {
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

  const gitlabFileContext = (
    await gitlabDocumentCache.get(textDocument, reporter)
  )?.model;

  connection.sendDiagnostics({
    uri: textDocument.uri,
    diagnostics,
  });
}

connection.listen();
