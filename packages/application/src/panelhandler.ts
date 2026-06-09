// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { ICommandPalette } from '@jupyterlab/apputils';
import { closeIcon } from '@jupyterlab/ui-components';
import { ArrayExt, find } from '@lumino/algorithm';
import { IDisposable } from '@lumino/disposable';
import { IMessageHandler, Message, MessageLoop } from '@lumino/messaging';
import { ISignal, Signal } from '@lumino/signaling';
import { Panel, StackedPanel, Widget } from '@lumino/widgets';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';

/**
 * A class which manages a panel and sorts its widgets by rank.
 */
export class PanelHandler {
  constructor() {
    MessageLoop.installMessageHook(this._panel, this._panelChildHook);
  }

  /**
   * Get the panel managed by the handler.
   */
  get panel(): Panel {
    return this._panel;
  }

  /**
   * Add a widget to the panel.
   *
   * If the widget is already added, it will be moved.
   */
  addWidget(widget: Widget, rank: number): void {
    widget.parent = null;
    const item = { widget, rank };
    const index = ArrayExt.upperBound(this._items, item, Private.itemCmp);
    ArrayExt.insert(this._items, index, item);
    this._panel.insertWidget(index, widget);
  }

  /**
   * A message hook for child remove messages on the panel handler.
   */
  private _panelChildHook = (
    handler: IMessageHandler,
    msg: Message
  ): boolean => {
    switch (msg.type) {
      case 'child-removed':
        {
          const widget = (msg as Widget.ChildMessage).child;
          ArrayExt.removeFirstWhere(this._items, (v) => v.widget === widget);
        }
        break;
      default:
        break;
    }
    return true;
  };

  protected _items = new Array<Private.IRankItem>();
  protected _panel = new Panel();
}

/**
 * A class which manages a side panel that can show at most one widget at a time.
 */
export class SidePanelHandler extends PanelHandler {
  /**
   * Construct a new side panel handler.
   */
  constructor(area: SidePanel.Area, translator: ITranslator) {
    super();
    this._area = area;
    this._panel.hide();
    this._translator = translator;
    this._currentWidget = null;
    this._lastCurrentWidget = null;

    this._widgetPanel = new StackedPanel();
    this._widgetPanel.widgetRemoved.connect(this._onWidgetRemoved, this);

    this._closeButton = document.createElement('button');
    this._closeButton.type = 'button';
    closeIcon.element({
      container: this._closeButton,
      height: '16px',
      width: 'auto',
    });
    this._closeButton.onclick = () => {
      this.collapse();
      this.hide();
    };
    const trans = this._translator.load('notebook');
    this._closeButton.className = 'jp-Button jp-SidePanel-collapse';
    this._closeButton.title = trans.__('Collapse side panel');

    // A compact strip holding the collapse button. Keeping it in the normal
    // flow (rather than overlaying the panel) ensures it never covers a
    // widget's own header or toolbar. The class is intentionally distinct from
    // JupyterLab's `jp-SidePanel-header` used by the panel widgets themselves.
    const header = new Widget();
    header.addClass('jp-SidePanel-collapseHeader');
    header.node.appendChild(this._closeButton);
    this._panel.addWidget(header);
    this._panel.addWidget(this._widgetPanel);

    // A thin handle along the inner edge of the panel used to resize it. It is
    // wrapped in an absolutely positioned widget so it can overlay the panel
    // edge without participating in the panel's flex layout.
    const resizeWidget = new Widget();
    resizeWidget.addClass('jp-SidePanel-resizeWidget');
    this._resizeHandle = document.createElement('div');
    this._resizeHandle.className = 'jp-SidePanel-resizeHandle';
    this._resizeHandle.setAttribute('role', 'separator');
    this._resizeHandle.setAttribute('aria-orientation', 'vertical');
    this._resizeHandle.setAttribute(
      'aria-label',
      trans.__('Resize %1 side panel', area)
    );
    this._resizeHandle.tabIndex = 0;
    this._updateResizeHandleAria();
    this._resizeHandle.addEventListener(
      'pointerdown',
      this._onResizePointerDown
    );
    this._resizeHandle.addEventListener('dblclick', () => {
      this._setWidth(Private.DEFAULT_WIDTH);
    });
    this._resizeHandle.addEventListener('keydown', this._onResizeHandleKeyDown);
    resizeWidget.node.appendChild(this._resizeHandle);
    this._panel.addWidget(resizeWidget);
  }

  /**
   * Get the current widget in the sidebar panel.
   */
  get currentWidget(): Widget | null {
    return (
      this._currentWidget ||
      this._lastCurrentWidget ||
      (this._items.length > 0 ? this._items[0].widget : null)
    );
  }

  /**
   * Get the area of the side panel
   */
  get area(): SidePanel.Area {
    return this._area;
  }

  /**
   * Whether the panel is visible
   */
  get isVisible(): boolean {
    return this._panel.isVisible;
  }

  /**
   * Get the stacked panel managed by the handler
   */
  override get panel(): Panel {
    return this._panel;
  }

  /**
   * Get the widgets list.
   */
  get widgets(): Readonly<Widget[]> {
    return this._items.map((obj) => obj.widget);
  }

  /**
   * Signal fired when a widget is added to the panel
   */
  get widgetAdded(): ISignal<SidePanelHandler, Widget> {
    return this._widgetAdded;
  }

  /**
   * Signal fired when a widget is removed from the panel
   */
  get widgetRemoved(): ISignal<SidePanelHandler, Widget> {
    return this._widgetRemoved;
  }

  /**
   * Signal fired when the side panel visibility or width changes.
   */
  get layoutChanged(): ISignal<SidePanelHandler, void> {
    return this._layoutChanged;
  }

  /**
   * The desired width of the side panel, in pixels.
   *
   * This is the single source of truth for the panel width. The shell mirrors
   * it onto a CSS variable so the stylesheet can size the panel and reserve the
   * matching amount of space for the centered content. The effective rendered
   * width may be smaller when the viewport is too narrow (see the CSS clamp).
   */
  get width(): number {
    return this._width;
  }

  /**
   * Whether the user is currently dragging the resize handle.
   */
  get isResizing(): boolean {
    return this._isResizing;
  }

  /**
   * Get the close button element.
   */
  get closeButton(): HTMLButtonElement {
    return this._closeButton;
  }

  /**
   * Get the resize handle element.
   */
  get resizeHandle(): HTMLElement {
    return this._resizeHandle;
  }

  /**
   * Expand the sidebar.
   *
   * #### Notes
   * This will open the most recently used widget, or the first widget
   * if there is no most recently used.
   */
  expand(id?: string): void {
    if (this._currentWidget) {
      this.collapse();
    }
    if (id) {
      this.activate(id);
    } else {
      const visibleWidget = this.currentWidget;
      if (visibleWidget) {
        this._currentWidget = visibleWidget;
        this.activate(visibleWidget.id);
      }
    }
  }

  /**
   * Activate a widget residing in the stacked panel by ID.
   *
   * @param id - The widget's unique ID.
   */
  activate(id: string): void {
    const widget = this._findWidgetByID(id);
    if (widget) {
      this._currentWidget = widget;
      widget.show();
      widget.activate();
    }
  }

  /**
   * Test whether the sidebar has the given widget by id.
   */
  has(id: string): boolean {
    return this._findWidgetByID(id) !== null;
  }

  /**
   * Collapse the sidebar so no items are expanded.
   */
  collapse(): void {
    this._currentWidget?.hide();
    this._currentWidget = null;
  }

  /**
   * Add a widget and its title to the stacked panel.
   *
   * If the widget is already added, it will be moved.
   */
  override addWidget(widget: Widget, rank: number): void {
    widget.parent = null;
    widget.hide();
    const item = { widget, rank };
    const index = this._findInsertIndex(item);
    ArrayExt.insert(this._items, index, item);
    this._widgetPanel.insertWidget(index, widget);

    this._refreshVisibility();

    this._widgetAdded.emit(widget);
  }

  /**
   * Hide the side panel
   */
  hide(): void {
    const wasHidden = this._isHiddenByUser;
    this._isHiddenByUser = true;
    this._refreshVisibility();
    if (!wasHidden) {
      this._layoutChanged.emit(undefined);
    }
  }

  /**
   * Show the side panel
   */
  show(): void {
    const wasHidden = this._isHiddenByUser;
    this._isHiddenByUser = false;
    this._refreshVisibility();
    if (wasHidden) {
      this._layoutChanged.emit(undefined);
    }
  }

  /**
   * Find the insertion index for a rank item.
   */
  private _findInsertIndex(item: Private.IRankItem): number {
    return ArrayExt.upperBound(this._items, item, Private.itemCmp);
  }

  /**
   * Find the index of the item with the given widget, or `-1`.
   */
  private _findWidgetIndex(widget: Widget): number {
    return ArrayExt.findFirstIndex(this._items, (i) => i.widget === widget);
  }

  /**
   * Find the widget with the given id, or `null`.
   */
  private _findWidgetByID(id: string): Widget | null {
    return find(this._items, (value) => value.widget.id === id)?.widget ?? null;
  }

  /**
   * Refresh the visibility of the stacked panel.
   */
  private _refreshVisibility(): void {
    this._panel.setHidden(this._isHiddenByUser);
  }

  /**
   * Start panel resizing.
   */
  private _onResizePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    this._resizeStartX = event.clientX;
    this._resizeStartWidth = this._panel.node.getBoundingClientRect().width;
    this._isResizing = true;

    document.body.classList.add('jp-mod-resizing-sidepanel');
    window.addEventListener('pointermove', this._onResizePointerMove);
    window.addEventListener('pointerup', this._onResizePointerUp);
    window.addEventListener('pointercancel', this._onResizePointerUp);
  };

  /**
   * Resize the panel while dragging.
   */
  private _onResizePointerMove = (event: PointerEvent): void => {
    if (!this._isResizing) {
      return;
    }
    event.preventDefault();

    const delta = event.clientX - this._resizeStartX;
    const signedDelta = this._area === 'left' ? delta : -delta;
    this._setWidth(this._resizeStartWidth + signedDelta);
  };

  /**
   * End panel resizing.
   */
  private _onResizePointerUp = (): void => {
    if (!this._isResizing) {
      return;
    }
    this._isResizing = false;
    document.body.classList.remove('jp-mod-resizing-sidepanel');
    window.removeEventListener('pointermove', this._onResizePointerMove);
    window.removeEventListener('pointerup', this._onResizePointerUp);
    window.removeEventListener('pointercancel', this._onResizePointerUp);
    MessageLoop.sendMessage(
      this._widgetPanel,
      Widget.ResizeMessage.UnknownSize
    );
    // Emit a final change now that resizing has stopped so the shell can run
    // the (deferred) reflow of the main content toolbar.
    this._layoutChanged.emit(undefined);
  };

  /**
   * Resize the panel with the keyboard when the resize handle is focused.
   */
  private _onResizeHandleKeyDown = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? 32 : 8;
    // Start from the rendered width so the first key press always has a
    // visible effect, even when the viewport clamped the desired width.
    const rendered =
      this._panel.node.getBoundingClientRect().width || this._width;
    let width: number;
    switch (event.key) {
      case 'ArrowLeft':
        width = rendered + (this._area === 'left' ? -step : step);
        break;
      case 'ArrowRight':
        width = rendered + (this._area === 'left' ? step : -step);
        break;
      case 'Home':
        width = Private.MIN_WIDTH;
        break;
      case 'End':
        width = Private.maxWidth();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    this._setWidth(width);
  };

  /**
   * Set the desired panel width, clamped to the allowed range.
   *
   * Only the desired width is tracked here; the shell mirrors it onto a CSS
   * variable that drives both the panel size and the space reserved for the
   * centered content, so the two can never get out of sync.
   */
  private _setWidth(width: number): void {
    this._width = Private.clampWidth(width);
    this._updateResizeHandleAria();
    // Let the shell mirror the new width onto its CSS variable first, then
    // relayout the panel contents against the updated node size.
    this._layoutChanged.emit(undefined);
    MessageLoop.sendMessage(
      this._widgetPanel,
      Widget.ResizeMessage.UnknownSize
    );
  }

  /**
   * Reflect the current width on the resize handle separator for assistive
   * technologies.
   */
  private _updateResizeHandleAria(): void {
    this._resizeHandle.setAttribute('aria-valuemin', `${Private.MIN_WIDTH}`);
    this._resizeHandle.setAttribute('aria-valuemax', `${Private.maxWidth()}`);
    this._resizeHandle.setAttribute('aria-valuenow', `${this._width}`);
  }

  /*
   * Handle the `widgetRemoved` signal from the panel.
   */
  private _onWidgetRemoved(sender: StackedPanel, widget: Widget): void {
    if (widget === this._lastCurrentWidget) {
      this._lastCurrentWidget = null;
    }
    ArrayExt.removeAt(this._items, this._findWidgetIndex(widget));

    this._refreshVisibility();

    this._widgetRemoved.emit(widget);
  }

  private _area: SidePanel.Area;
  private _isHiddenByUser = false;
  private _widgetPanel: StackedPanel;
  private _currentWidget: Widget | null;
  private _lastCurrentWidget: Widget | null;
  private _closeButton: HTMLButtonElement;
  private _resizeHandle: HTMLDivElement;
  private _isResizing = false;
  private _resizeStartX = 0;
  private _resizeStartWidth = 0;
  private _width = Private.DEFAULT_WIDTH;
  private _widgetAdded: Signal<SidePanelHandler, Widget> = new Signal(this);
  private _widgetRemoved: Signal<SidePanelHandler, Widget> = new Signal(this);
  private _translator: ITranslator = nullTranslator;
  private _layoutChanged: Signal<SidePanelHandler, void> = new Signal(this);
}

/**
 * A name space for SideBarPanel functions.
 */
export namespace SidePanel {
  /**
   * The areas of the sidebar panel
   */
  export type Area = 'left' | 'right';
}

/**
 * A class to manages the palette entries associated to the side panels.
 */
export class SidePanelPalette {
  /**
   * Construct a new side panel palette.
   */
  constructor(options: SidePanelPaletteOption) {
    this._commandPalette = options.commandPalette;
    this._command = options.command;
  }

  /**
   * Get a command palette item from the widget id and the area.
   */
  getItem(
    widget: Readonly<Widget>,
    area: 'left' | 'right'
  ): SidePanelPaletteItem | null {
    return (
      this._items.find(
        (item) => item.widgetId === widget.id && item.area === area
      ) ?? null
    );
  }

  /**
   * Add an item to the command palette.
   */
  addItem(widget: Readonly<Widget>, area: 'left' | 'right'): void {
    // Check if the item does not already exist.
    if (this.getItem(widget, area)) {
      return;
    }

    // Add a new item in command palette.
    const disposableDelegate = this._commandPalette.addItem({
      command: this._command,
      category: 'View',
      args: {
        side: area,
        title: `Show ${widget.title.caption}`,
        id: widget.id,
      },
    });

    // Keep the disposableDelegate object to be able to dispose of the item if the widget
    // is remove from the side panel.
    this._items.push({
      widgetId: widget.id,
      area: area,
      disposable: disposableDelegate,
    });
  }

  /**
   * Remove an item from the command palette.
   */
  removeItem(widget: Readonly<Widget>, area: 'left' | 'right'): void {
    const item = this.getItem(widget, area);
    if (item) {
      item.disposable.dispose();
    }
  }

  private _command: string;
  private _commandPalette: ICommandPalette;
  private _items: SidePanelPaletteItem[] = [];
}

type SidePanelPaletteItem = {
  /**
   * The ID of the widget associated to the command palette.
   */
  widgetId: string;

  /**
   * The area of the panel associated to the command palette.
   */
  area: 'left' | 'right';

  /**
   * The disposable object to remove the item from command palette.
   */
  disposable: IDisposable;
};

/**
 * An interface for the options to include in SideBarPalette constructor.
 */
type SidePanelPaletteOption = {
  /**
   * The commands palette.
   */
  commandPalette: ICommandPalette;

  /**
   * The command to call from each side panel menu entry.
   *
   * ### Notes
   * That command required 3 args :
   *      side: 'left' | 'right', the area to toggle
   *      title: string, label of the command
   *      id: string, id of the widget to activate
   */
  command: string;
};

/**
 * A namespace for private module data.
 */
namespace Private {
  /**
   * The default side panel width, in pixels.
   *
   * Matches the initial `--jp-private-{left,right}-panel-size` values in
   * style/base.css.
   */
  export const DEFAULT_WIDTH = 256;

  /**
   * The minimum side panel width, in pixels.
   *
   * Matches `--jp-private-side-panel-min-width` in style/base.css.
   */
  export const MIN_WIDTH = 180;

  /**
   * The minimum width to keep for the main content beside the side panels.
   *
   * Matches the value baked into `--jp-private-side-panel-max-width` in
   * style/base.css so the width tracked while dragging is the width that is
   * actually rendered, avoiding a "dead zone" when the handle is dragged past
   * the maximum.
   */
  export const MIN_CONTENT_WIDTH = 520;

  /**
   * The widest a side panel may currently be: half the space beyond the
   * {@link MIN_CONTENT_WIDTH} reserved for the content, but never less than
   * {@link MIN_WIDTH}.
   */
  export function maxWidth(): number {
    return Math.max(
      MIN_WIDTH,
      Math.round((window.innerWidth - MIN_CONTENT_WIDTH) / 2)
    );
  }

  /**
   * Clamp a candidate side panel width to the range allowed for the current
   * viewport: never narrower than {@link MIN_WIDTH} and never wider than
   * {@link maxWidth}.
   */
  export function clampWidth(width: number): number {
    return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(width)));
  }

  /**
   * An object which holds a widget and its sort rank.
   */
  export interface IRankItem {
    /**
     * The widget for the item.
     */
    widget: Widget;

    /**
     * The sort rank of the widget.
     */
    rank: number;
  }
  /**
   * A less-than comparison function for side bar rank items.
   */
  export function itemCmp(first: IRankItem, second: IRankItem): number {
    return first.rank - second.rank;
  }
}
