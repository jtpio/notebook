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

    this._panel.addWidget(new Widget({ node: this._closeButton }));
    this._panel.addWidget(this._widgetPanel);

    this._resizeHandle = document.createElement('div');
    this._resizeHandle.className = 'jp-SidePanel-resizeHandle';
    this._resizeHandle.setAttribute('role', 'separator');
    this._resizeHandle.setAttribute('aria-orientation', 'vertical');
    this._resizeHandle.setAttribute(
      'aria-label',
      trans.__('Resize %1 side panel', area)
    );
    this._resizeHandle.tabIndex = 0;
    this._resizeHandle.addEventListener(
      'pointerdown',
      this._onResizePointerDown
    );
    this._resizeHandle.addEventListener(
      'pointermove',
      this._onResizePointerMove
    );
    this._resizeHandle.addEventListener('pointerup', this._onResizePointerUp);
    this._resizeHandle.addEventListener(
      'pointercancel',
      this._onResizePointerUp
    );
    this._resizeHandle.addEventListener('dblclick', () => {
      this.width = null;
    });
    this._resizeHandle.addEventListener('keydown', this._onResizeHandleKeyDown);
    this._panel.addWidget(new Widget({ node: this._resizeHandle }));
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
   * The desired width of the side panel in pixels, or `null` for the default
   * width. It is kept within the limits set by the stylesheet.
   */
  get width(): number | null {
    return this._width;
  }
  set width(value: number | null) {
    if (value !== null) {
      const { min, max } = this._widthLimits();
      value = Math.round(Math.max(min, Math.min(value, max)));
    }
    if (value === this._width) {
      return;
    }
    this._width = value;
    // Emit first so the shell updates the layout before the panel contents
    // relayout against the new node size.
    this._layoutChanged.emit(undefined);
    MessageLoop.sendMessage(
      this._widgetPanel,
      Widget.ResizeMessage.UnknownSize
    );
    if (!this._isResizing) {
      this._updateResizeHandleAria();
    }
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
    if (this._isHiddenByUser) {
      return;
    }
    this._isHiddenByUser = true;
    this._refreshVisibility();
    this._layoutChanged.emit(undefined);
  }

  /**
   * Show the side panel
   */
  show(): void {
    if (!this._isHiddenByUser) {
      return;
    }
    this._isHiddenByUser = false;
    this._refreshVisibility();
    this._layoutChanged.emit(undefined);
    this._updateResizeHandleAria();
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
   * Start a resize drag, capturing subsequent pointer events on the handle.
   */
  private _onResizePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this._resizeHandle.setPointerCapture(event.pointerId);
    this._resizeStartX = event.clientX;
    this._resizeStartWidth = this._panel.node.getBoundingClientRect().width;
    this._isResizing = true;
    this._resizeHandle.classList.add('jp-mod-active');
    document.body.classList.add('jp-mod-resizing-sidepanel');
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
    this.width =
      this._resizeStartWidth + (this._area === 'left' ? delta : -delta);
  };

  /**
   * End panel resizing.
   */
  private _onResizePointerUp = (): void => {
    if (!this._isResizing) {
      return;
    }
    this._isResizing = false;
    this._resizeHandle.classList.remove('jp-mod-active');
    document.body.classList.remove('jp-mod-resizing-sidepanel');
    this._updateResizeHandleAria();
  };

  /**
   * Resize the panel with the keyboard when the resize handle is focused.
   */
  private _onResizeHandleKeyDown = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? 32 : 8;
    // Step from the rendered width, which differs from the desired one for
    // the default width or when the window is too small for it.
    const rendered = this._panel.node.getBoundingClientRect().width;
    let width: number;
    switch (event.key) {
      case 'ArrowLeft':
        width = rendered + (this._area === 'left' ? -step : step);
        break;
      case 'ArrowRight':
        width = rendered + (this._area === 'left' ? step : -step);
        break;
      case 'Home':
        width = 0;
        break;
      case 'End':
        width = window.innerWidth;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.width = width;
  };

  /**
   * The width limits the stylesheet sets on the panel, in pixels.
   */
  private _widthLimits(): { min: number; max: number } {
    const { minWidth, maxWidth } = getComputedStyle(this._panel.node);
    return {
      min: parseFloat(minWidth) || 0,
      max: parseFloat(maxWidth) || Infinity,
    };
  }

  /**
   * Reflect the width range and the rendered width on the separator for
   * assistive technologies.
   */
  private _updateResizeHandleAria(): void {
    const { min, max } = this._widthLimits();
    const { width } = this._panel.node.getBoundingClientRect();
    this._resizeHandle.setAttribute('aria-valuemin', `${Math.round(min)}`);
    this._resizeHandle.setAttribute('aria-valuemax', `${Math.round(max)}`);
    this._resizeHandle.setAttribute('aria-valuenow', `${Math.round(width)}`);
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
  private _isHiddenByUser = true;
  private _widgetPanel: StackedPanel;
  private _currentWidget: Widget | null;
  private _lastCurrentWidget: Widget | null;
  private _closeButton: HTMLButtonElement;
  private _resizeHandle: HTMLDivElement;
  private _isResizing = false;
  private _resizeStartX = 0;
  private _resizeStartWidth = 0;
  private _width: number | null = null;
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
