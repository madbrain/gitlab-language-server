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
  LocationLink,
  DidChangeConfigurationNotification,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { GitlabDocumentCache } from "./documentCache";
import { ValidationDebouncer } from "./validationDebounce";
import { ErrorReporter, NullReporter } from "./lang/error-reporter";
import { Range as InternalRange } from "./lang/generic-model";
import { CompletionPositioner } from "./lang/completion-positioner";
import { GenericTextDocument } from "./lang/text-document";
import { DefaultIncludeResolver, GitlabService } from "./lang/gitlabci";
import { OperationOption } from "./lang/gitlab.model";
import { VariablesProvider } from "./lang/gitlab-validator";
import { expandVariables } from "./lang/variable-expander";

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
const variablesProvider: VariablesProvider = {
  getProjectVariables() {
    // TODO add predefined variables -> may depend on workspace configuration
    return connection.workspace
      .getConfiguration("gitlabci-language-server")
      .then((settings) => {
        if (!settings) {
          return {};
        }
        connection.console.log(`CONF ${settings.project.variables}`);
        return expandVariables(
          (settings as GitlabCISettings).project.variables,
        );
      });
  },
};
const includeResolver = new DefaultIncludeResolver(logConsole);
const gitlabService = new GitlabService(includeResolver, variablesProvider);
const gitlabDocumentCache = new GitlabDocumentCache(gitlabService);
const validationDebouncer = new ValidationDebouncer(500, validateTextDocument);
const options: OperationOption = {};
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  hasConfigurationCapability = !!(
    params.capabilities.workspace &&
    !!params.capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    params.capabilities.workspace &&
    !!params.capabilities.workspace.workspaceFolders
  );
  if (params.workspaceFolders) {
    includeResolver.setWorkspaces(
      params.workspaceFolders.map((workspaceFolder) => workspaceFolder.uri),
    );
  }
  if (params.capabilities.textDocument?.definition?.linkSupport) {
    options.definitionLinkSupport = true;
  }
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {},
      definitionProvider: {},
    },
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined,
    );
    //  TODO pull settings
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log("Workspace folder change event received.");
    });
  }
  documents.onDidChangeContent((change) => {
    validationDebouncer.validate(change.document);
  });
  documents.onDidClose((event) => {
    validationDebouncer.cleanPendingValidation(event.document);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  });
});

interface GitlabCISettings {
  project: {
    variables: { [variable: string]: string };
  };
}

connection.onDidChangeConfiguration((change) => {
  // TODO pull again settings
  connection.workspace
    .getConfiguration("gitlabci-language-server")
    .then((settings) => {
      connection.console.log(`WORK CONFIG ${JSON.stringify(settings)}`);
    });
});

function adaptDocument(document: TextDocument) {
  return {
    uri: document.uri,
    makeRange: (range: InternalRange) => {
      return {
        start: document.positionAt(range.start),
        end: document.positionAt(range.end),
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
  if (document) {
    const position = document.offsetAt(params.position);
    const cachedEntry = await gitlabDocumentCache.get(document, NullReporter);
    if (cachedEntry && cachedEntry.content && cachedEntry.model) {
      connection.console.log(`GOTO DEFINITION ${position}`);
      return cachedEntry.model.mainFile.gotoDefinitionAt({
        document: adaptDocument(document),
        context: cachedEntry.model,
        position: position,
        options,
      });
    }
  }
  return [];
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
