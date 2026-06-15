// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
} from '@jupyterlab/application';

import { PageConfig, PathExt, URLExt } from '@jupyterlab/coreutils';

import {
  IDocumentWidgetOpener,
  IRecentsManager,
  RecentsManager,
} from '@jupyterlab/docmanager';

import { IDocumentWidget, DocumentRegistry } from '@jupyterlab/docregistry';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { IDataConnector, StateDB } from '@jupyterlab/statedb';

import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import {
  INotebookPathOpener,
  INotebookShell,
  defaultNotebookPathOpener,
} from '@jupyter-notebook/application';

import { Signal } from '@lumino/signaling';

/**
 * A plugin to open documents in a new browser tab.
 *
 */
const opener: JupyterFrontEndPlugin<IDocumentWidgetOpener> = {
  id: '@jupyter-notebook/docmanager-extension:opener',
  autoStart: true,
  optional: [INotebookPathOpener, INotebookShell],
  provides: IDocumentWidgetOpener,
  description: 'Open documents in a new browser tab',
  activate: (
    app: JupyterFrontEnd,
    notebookPathOpener: INotebookPathOpener | null,
    notebookShell: INotebookShell | null
  ) => {
    const baseUrl = PageConfig.getBaseUrl();
    const docRegistry = app.docRegistry;
    const pathOpener = notebookPathOpener ?? defaultNotebookPathOpener;
    let id = 0;
    return new (class {
      async open(
        widget: IDocumentWidget,
        options?: DocumentRegistry.IOpenOptions
      ) {
        const widgetName = options?.type ?? '';
        const ref = options?.ref;
        // check if there is an setting override and if it would add the widget in the main area
        const userLayoutArea = notebookShell?.userLayout?.[widgetName]?.area;

        if (ref !== '_noref' && userLayoutArea === undefined) {
          const path = widget.context.path;
          const ext = PathExt.extname(path);
          let route = 'edit';
          if (
            (widgetName === 'default' && ext === '.ipynb') ||
            widgetName.includes('Notebook')
          ) {
            // make sure to save the notebook before opening it in a new tab
            // so the kernel info is saved (if created from the New dropdown)
            if (widget.context.sessionContext.kernelPreference.name) {
              await widget.context.save();
            }
            route = 'notebooks';
          }
          // append ?factory only if it's not the default
          const defaultFactory = docRegistry.defaultWidgetFactory(path);
          let searchParams = undefined;
          if (widgetName !== defaultFactory.name) {
            searchParams = new URLSearchParams({
              factory: widgetName,
            });
          }

          pathOpener.open({
            prefix: URLExt.join(baseUrl, route),
            path,
            searchParams,
          });

          // dispose the widget since it is not used on this page
          widget.dispose();
          return;
        }

        // otherwise open the document on the current page

        if (!widget.id) {
          widget.id = `document-manager-${++id}`;
        }
        widget.title.dataset = {
          type: 'document-title',
          ...widget.title.dataset,
        };
        if (!widget.isAttached) {
          app.shell.add(widget, 'main', options || {});
        }
        app.shell.activateById(widget.id);
        this._opened.emit(widget);
      }

      get opened() {
        return this._opened;
      }

      private _opened = new Signal<this, IDocumentWidget>(this);
    })();
  },
};

/**
 * The key prefix used to persist the recent documents in the browser local
 * storage. This allows the list to be shared across the separate Notebook
 * pages (tree, notebooks, edit, ...), which the in-memory application state
 * database does not support.
 */
const RECENTS_STORAGE_PREFIX = '@jupyter-notebook/docmanager:recents';

/**
 * A minimal data connector persisting string values in the browser local
 * storage, used to back the recent documents state database.
 */
class LocalStorageConnector implements IDataConnector<string> {
  constructor(prefix: string) {
    this._prefix = prefix;
  }

  async fetch(id: string): Promise<string | undefined> {
    const value = localStorage.getItem(this._key(id));
    return value === null ? undefined : value;
  }

  async list(namespace = ''): Promise<{ ids: string[]; values: string[] }> {
    const ids: string[] = [];
    const values: string[] = [];
    const prefix = `${this._prefix}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(prefix)) {
        continue;
      }
      const id = key.slice(prefix.length);
      if (namespace === '' || namespace === id.split(':')[0]) {
        ids.push(id);
        values.push(localStorage.getItem(key) as string);
      }
    }
    return { ids, values };
  }

  async remove(id: string): Promise<void> {
    localStorage.removeItem(this._key(id));
  }

  async save(id: string, value: string): Promise<void> {
    localStorage.setItem(this._key(id), value);
  }

  private _key(id: string): string {
    return `${this._prefix}:${id}`;
  }

  private _prefix: string;
}

/**
 * A plugin providing a recent documents manager.
 *
 * Unlike JupyterLab's `@jupyterlab/docmanager-extension:recents` plugin, the
 * recent documents are persisted in the browser local storage rather than the
 * application state database. This is required because the Notebook
 * application uses a separate page (and a fresh in-memory state database) for
 * each document, so the list of recently opened documents needs a shared,
 * persistent store to be visible from the tree page.
 */
const recents: JupyterFrontEndPlugin<IRecentsManager> = {
  id: '@jupyter-notebook/docmanager-extension:recents',
  description:
    'Provides a manager of recently opened and closed documents, persisted across pages in the browser local storage.',
  autoStart: true,
  provides: IRecentsManager,
  optional: [ISettingRegistry, ITranslator],
  activate: (
    app: JupyterFrontEnd,
    settingRegistry: ISettingRegistry | null,
    translator: ITranslator | null
  ): IRecentsManager => {
    const { commands, serviceManager } = app;
    const trans = (translator ?? nullTranslator).load('notebook');

    const stateDB = new StateDB({
      connector: new LocalStorageConnector(RECENTS_STORAGE_PREFIX),
    });
    const recentsManager = new RecentsManager({
      stateDB,
      contents: serviceManager.contents,
    });

    // Keep the maximal number of recents in sync with the document manager
    // settings, matching the behavior of the JupyterLab recents plugin.
    const updateSettings = (settings: ISettingRegistry.ISettings) => {
      recentsManager.maximalRecentsLength = settings.get('maxNumberRecents')
        .composite as number;
    };

    if (settingRegistry) {
      void Promise.all([
        app.restored,
        settingRegistry.load('@jupyterlab/docmanager-extension:plugin'),
      ])
        .then(([, settings]) => {
          settings.changed.connect(updateSettings);
          updateSettings(settings);
        })
        .catch((reason) => {
          console.warn(
            'Failed to load the document manager settings for recents',
            reason
          );
        });
    }

    commands.addCommand('docmanager:clear-recents', {
      execute: () => {
        recentsManager.clearRecents();
      },
      isEnabled: () =>
        recentsManager.recentlyOpened.length !== 0 ||
        recentsManager.recentlyClosed.length !== 0,
      label: trans.__('Clear Recent Documents'),
      caption: trans.__('Clear the list of recently opened items.'),
      describedBy: {
        args: {
          type: 'object',
          properties: {},
        },
      },
    });

    return recentsManager;
  },
};

/**
 * Export the plugins as default.
 */
const plugins: JupyterFrontEndPlugin<any>[] = [opener, recents];

export default plugins;
