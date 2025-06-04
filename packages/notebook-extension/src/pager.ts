// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { ISessionContext } from '@jupyterlab/apputils';
import { KernelMessage } from '@jupyterlab/services';
import { IRenderMimeRegistry, MimeModel } from '@jupyterlab/rendermime';
import { DataConnector } from '@jupyterlab/statedb';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { closeIcon } from '@jupyterlab/ui-components';
import { IDisposable } from '@lumino/disposable';
import { Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';

/**
 * The CSS class added to pager widgets.
 */
const PAGER_CLASS = 'jp-Pager';

/**
 * The CSS class added to pager content.
 */
const PAGER_CONTENT_CLASS = 'jp-Pager-content';

/**
 * A widget that displays pager content (help/documentation) in the down panel.
 */
export class PagerWidget extends Widget {
  constructor(options: PagerWidget.IOptions) {
    super();
    this.addClass(PAGER_CLASS);
    this.id = 'jp-pager';
    this.title.label = 'Help';
    this.title.closable = true;
    this.title.icon = closeIcon;

    this._rendermime = options.rendermime;
    this._translator = options.translator || nullTranslator;
    this._trans = this._translator.load('jupyterlab');

    // Create content area
    this._content = document.createElement('div');
    this._content.className = PAGER_CONTENT_CLASS;

    this.node.appendChild(this._content);
  }

  /**
   * Show inspection data in the pager.
   */
  showInspectionData(data: Record<string, any>): void {
    this._content.innerHTML = '';

    if (!data || Object.keys(data).length === 0) {
      this._content.textContent = this._trans.__('No help available.');
      return;
    }

    // Render the data using the rendermime registry
    const mimeType = this._getBestMimeType(data);
    if (mimeType && data[mimeType]) {
      const model = new MimeModel({ data: { [mimeType]: data[mimeType] } });
      const renderer = this._rendermime.createRenderer(mimeType);
      renderer.renderModel(model).then(() => {
        this._content.appendChild(renderer.node);
      });
    } else {
      this._content.textContent = this._trans.__('No help available.');
    }
  }

  /**
   * Get the best MIME type for displaying the data.
   */
  private _getBestMimeType(data: Record<string, any>): string | null {
    const mimeTypes = Object.keys(data);
    const preferredTypes = [
      'text/html',
      'text/markdown',
      'text/latex',
      'text/plain',
    ];

    for (const preferred of preferredTypes) {
      if (mimeTypes.includes(preferred)) {
        return preferred;
      }
    }

    return mimeTypes.length > 0 ? mimeTypes[0] : null;
  }

  private _rendermime: IRenderMimeRegistry;
  private _translator: ITranslator;
  private _trans: any;
  private _content: HTMLDivElement;
}

/**
 * The namespace for PagerWidget static methods.
 */
export namespace PagerWidget {
  /**
   * The options for creating a pager widget.
   */
  export interface IOptions {
    /**
     * The rendermime registry.
     */
    rendermime: IRenderMimeRegistry;

    /**
     * The application language translator.
     */
    translator?: ITranslator;
  }
}

/**
 * A data connector for pager inspection requests.
 */
export class PagerConnector extends DataConnector<
  KernelMessage.IInspectReply,
  void,
  string,
  string
> {
  constructor(options: PagerConnector.IOptions) {
    super();
    this._sessionContext = options.sessionContext;
  }

  /**
   * Fetch inspection data from the kernel.
   */
  async fetch(id: string): Promise<KernelMessage.IInspectReply | undefined> {
    // This method is required by DataConnector but we use a custom method instead
    throw new Error('Use fetchInspection method instead');
  }

  /**
   * Fetch inspection data from the kernel.
   */
  async fetchInspection(
    options: PagerConnector.IFetchOptions
  ): Promise<KernelMessage.IInspectReply> {
    const { code, cursorPos, detailLevel } = options;

    if (!this._sessionContext?.session?.kernel) {
      throw new Error('No kernel available for inspection');
    }

    const kernel = this._sessionContext.session.kernel;
    const content: KernelMessage.IInspectRequestMsg['content'] = {
      code,
      cursor_pos: cursorPos,
      detail_level: (detailLevel || 0) as 0 | 1,
    };

    const future = kernel.requestInspect(content);
    const reply = await future;

    if (reply.content.status === 'ok') {
      return reply.content as KernelMessage.IInspectReply;
    } else {
      throw new Error('Inspection request failed');
    }
  }

  private _sessionContext: ISessionContext;
}

/**
 * The namespace for PagerConnector static methods.
 */
export namespace PagerConnector {
  /**
   * The options for creating a pager connector.
   */
  export interface IOptions {
    /**
     * The session context.
     */
    sessionContext: ISessionContext;
  }

  /**
   * The fetch options.
   */
  export interface IFetchOptions {
    /**
     * The code to inspect.
     */
    code: string;

    /**
     * The cursor position in the code.
     */
    cursorPos: number;

    /**
     * The detail level for the inspection.
     */
    detailLevel?: number;
  }
}

/**
 * A handler for pager inspection requests.
 */
export class PagerHandler implements IDisposable {
  constructor(options: PagerHandler.IOptions) {
    this._connector = options.connector;
  }

  /**
   * Handle an inspection request.
   */
  async handleInspection(
    code: string,
    cursorPos: number
  ): Promise<KernelMessage.IInspectReply> {
    return this._connector.fetchInspection({
      code,
      cursorPos,
      detailLevel: 0,
    });
  }

  /**
   * Test whether the handler is disposed.
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Dispose of the handler.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    Signal.clearData(this);
  }

  private _connector: PagerConnector;
  private _isDisposed = false;
}

/**
 * The namespace for PagerHandler static methods.
 */
export namespace PagerHandler {
  /**
   * The options for creating a pager handler.
   */
  export interface IOptions {
    /**
     * The data connector for inspection requests.
     */
    connector: PagerConnector;

    /**
     * The rendermime registry.
     */
    rendermime: IRenderMimeRegistry;

    /**
     * The application language translator.
     */
    translator?: ITranslator;
  }
}
