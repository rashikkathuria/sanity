// @flow
import type {
  BlockContentFeatures,
  FormBuilderValue,
  Marker,
  Path,
  SlateChange,
  SlateNode,
  SlateSelection,
  SlateValue,
  Type
} from '../typeDefs'
import ReactDOM from 'react-dom'
import Base64 from 'slate-base64-serializer'

import React from 'react'
import {Block, Range} from 'slate'
import {isEqual} from 'lodash'
import {Editor, setEventTransfer, getEventRange} from 'slate-react'
import {IntentLink} from 'part:@sanity/base/router'
import LinkIcon from 'part:@sanity/base/link-icon'
import Stacked from 'part:@sanity/components/utilities/stacked'
import Escapable from 'part:@sanity/components/utilities/escapable'
import {Tooltip} from '@sanity/react-tippy'
import classNames from 'classnames'

import {resolveTypeName} from '../../../utils/resolveTypeName'
import {PatchEvent} from '../../../PatchEvent'
import {FOCUS_TERMINATOR} from '../../../utils/pathUtils'

import DeleteButton from '../DeleteButton'
import EditButton from '../EditButton'
import InvalidValue from '../../InvalidValueInput'
import Preview from '../../../Preview'

import styles from './styles/InlineObject.css'
import ViewButton from '../ViewButton'

type Props = {
  attributes: any,
  blockContentFeatures: BlockContentFeatures,
  editor: Editor,
  editorValue: SlateValue,
  hasFormBuilderFocus: boolean,
  isSelected?: boolean,
  markers: Marker[],
  node: Block,
  onChange: (change: SlateChange, callback?: (SlateChange) => void) => void,
  onFocus: Path => void,
  onPatch: (event: PatchEvent, value?: FormBuilderValue[]) => void,
  readOnly?: boolean,
  type: ?Type
}

type State = {
  isDragging: boolean,
  menuOpen: boolean
}

const NOOP = () => {}

function shouldUpdateDropTarget(range, dropTarget) {
  if (!dropTarget) {
    return true
  }
  return range.focus.offset !== dropTarget.selection.focus.offset
}

export default class InlineObject extends React.Component<Props, State> {
  static defaultProps = {
    isSelected: false,
    readOnly: false
  }

  _dropTarget: ?{node: HTMLElement, selection: SlateSelection} = null
  _editorNode: ?HTMLElement = null
  _previewContainer: ?HTMLElement = null

  state = {
    isDragging: false,
    menuOpen: false
  }

  componentDidMount() {
    const {editor} = this.props
    const elm = ReactDOM.findDOMNode(editor) // eslint-disable-line react/no-find-dom-node
    if (elm instanceof HTMLElement) {
      this._editorNode = elm
    }
  }

  componentWillUnmount() {
    this.removeDragHandlers()
  }

  addDragHandlers() {
    if (this._editorNode) {
      this._editorNode.addEventListener('dragover', this.handleDragOverOtherNode)
    }
    if (this._editorNode) {
      this._editorNode.addEventListener('dragleave', this.handleDragLeave)
    }
  }

  removeDragHandlers() {
    if (this._editorNode) {
      this._editorNode.removeEventListener('dragover', this.handleDragOverOtherNode)
    }
    if (this._editorNode) {
      this._editorNode.removeEventListener('dragleave', this.handleDragLeave)
    }
  }

  handleDragStart = (event: SyntheticDragEvent<>) => {
    const {node} = this.props
    this.setState({isDragging: true})
    this.addDragHandlers()
    const element = ReactDOM.findDOMNode(this._previewContainer) // eslint-disable-line react/no-find-dom-node
    if (element && element instanceof HTMLElement) {
      const encoded = Base64.serializeNode(node, {preserveKeys: true})
      setEventTransfer(event, 'node', encoded)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setDragImage(element, element.clientWidth / 2, -10)
    }
  }

  // Remove the drop target if we leave the editors nodes
  handleDragLeave = (event: DragEvent) => {
    if (event.currentTarget === this._editorNode) {
      this.resetDropTarget()
    }
  }

  resetDropTarget() {
    this._dropTarget = null
  }

  handleDragOverOtherNode = (event: DragEvent) => {
    if (!this.state.isDragging) {
      return
    }

    const targetDOMNode = event.currentTarget

    // As the event is registered on the editor parent node
    // ignore the event if it is coming from from the editor node itself
    if (targetDOMNode === this._editorNode) {
      return
    }

    const {editorValue, onChange} = this.props

    const range = getEventRange(event, editorValue)
    if (range === null || typeof range.focus.offset === undefined) {
      return
    }

    const targetNode = editorValue.document.getDescendant(range.focus.key)

    // If we are dragging over another inline return
    if (editorValue.document.getClosestInline(targetNode.key)) {
      return
    }

    // If we are dragging over a custom type block return
    const block = editorValue.document.getClosestBlock(range.focus.key)
    if (block && block.type !== 'contentBlock') {
      return
    }

    const moveCursorChange = this.moveCursor(range, targetNode)
    const selection = moveCursorChange.value.selection
    if (shouldUpdateDropTarget(selection, this._dropTarget)) {
      this._dropTarget = {node: targetNode, selection}
      onChange(moveCursorChange)
    }
  }

  moveCursor(range: Range, node: SlateNode) {
    const {editorValue} = this.props
    let theOffset = range.focus.offset

    // Check if it is acceptable to move the cursor here
    const texts = editorValue.document.getTextsAtRange(
      Range.create({
        anchor: {
          key: node.key,
          offset: theOffset - 1
        },
        focus: {
          key: node.key,
          offset: theOffset
        }
      })
    )
    if (!texts.size) {
      theOffset = 0
    }
    const change = editorValue
      .change()
      .moveToStartOfNode(node)
      .moveForward(theOffset)
      .focus()
    return change
  }

  handleDragEnd = (event: SyntheticDragEvent<>) => {
    this.setState({isDragging: false})

    const {onChange, node, editorValue} = this.props

    const target = this._dropTarget

    // Return if this is our node
    if (!target || target.node === node) {
      this.resetDropTarget()
      return
    }
    const change = editorValue
      .change()
      .select(target.selection)
      .removeNodeByKey(node.key)
      .insertInline(node)
      .moveToEndOfNode(node)
      .focus()

    onChange(change)

    this.resetDropTarget()
  }

  handleInvalidValue = (event: PatchEvent) => {
    let _event = event
    const {editorValue, onPatch} = this.props
    const {focusBlock} = editorValue
    const value = this.getValue()
    const path = [{_key: focusBlock.key}, 'children', {_key: value._key}]
    path.reverse().forEach(part => {
      _event = _event.prefixAll(part)
    })
    onPatch(_event, value)
  }

  handleRemoveValue = (event: SyntheticMouseEvent<>) => {
    event.preventDefault()
    event.stopPropagation()
    const {editorValue, node, onChange} = this.props
    const change = editorValue.change()
    onChange(change.removeNodeByKey(node.key).focus())
  }

  handleCancelEvent = (event: SyntheticEvent<>) => {
    event.stopPropagation()
    event.preventDefault()
  }

  handleEditStart = (event: SyntheticMouseEvent<>) => {
    event.stopPropagation()
    const {node, onFocus, onChange, editorValue} = this.props
    const {focusBlock} = editorValue
    const change = editorValue
      .change()
      .moveToEndOfNode(node)
      .focus()
      .blur()
    onChange(change, () =>
      onFocus([{_key: focusBlock.key}, 'children', {_key: node.key}, FOCUS_TERMINATOR])
    )
  }

  handleView = (event: SyntheticMouseEvent<>) => {
    event.stopPropagation()
    const {node, onFocus, editorValue} = this.props
    const {focusBlock} = editorValue
    onFocus([{_key: focusBlock.key}, 'children', {_key: node.key}, FOCUS_TERMINATOR])
  }

  handleCloseMenu = () => {
    this.setState({menuOpen: false})
  }

  refPreviewContainer = (elm: ?HTMLSpanElement) => {
    this._previewContainer = elm
  }

  handleShowMenu = () => {
    this.setState({menuOpen: true})
  }

  getValue() {
    return this.props.node.data.get('value')
  }

  renderMenu(value: FormBuilderValue) {
    const {readOnly} = this.props
    return (
      <Stacked>
        {isActive => {
          return (
            <Escapable onEscape={isActive ? this.handleCloseMenu : NOOP}>
              <div className={styles.functions}>
                {value._ref && (
                  <IntentLink
                    className={styles.linkToReference}
                    intent="edit"
                    params={{id: value._ref}}
                  >
                    <LinkIcon />
                  </IntentLink>
                )}
                {readOnly && (
                  <ViewButton title="View this object" onClick={this.handleView}>
                    View
                  </ViewButton>
                )}
                {!readOnly && (
                  <EditButton title="Edit this object" onClick={this.handleEditStart}>
                    Edit
                  </EditButton>
                )}
                {!readOnly && (
                  <DeleteButton title="Remove this object" onClick={this.handleRemoveValue}>
                    Delete
                  </DeleteButton>
                )}
              </div>
            </Escapable>
          )
        }}
      </Stacked>
    )
  }

  renderPreview(value: FormBuilderValue) {
    const {type} = this.props
    const {menuOpen} = this.state
    const valueKeys = value ? Object.keys(value) : []
    const isEmpty = !value || isEqual(valueKeys.sort(), ['_key', '_type'].sort())
    return (
      <Tooltip
        arrow
        theme="light"
        trigger="manual"
        open={menuOpen}
        position="bottom"
        interactive
        useContext
        duration={100}
        style={{padding: 0, display: 'inline-block', minWidth: '1em'}}
        unmountHTMLWhenHide
        onRequestClose={menuOpen && this.handleCloseMenu}
        html={this.renderMenu(value)}
      >
        {!isEmpty && <Preview type={type} value={value} layout="inline" />}
        {isEmpty && <span>Click to edit</span>}
      </Tooltip>
    )
  }

  render() {
    const {
      attributes,
      node,
      editorValue,
      isSelected,
      readOnly,
      markers,
      blockContentFeatures
    } = this.props
    const value = this.getValue()
    const valueType = resolveTypeName(value)
    const validTypes = blockContentFeatures.types.inlineObjects.map(objType => objType.name)

    if (!validTypes.includes(valueType)) {
      return (
        <div onClick={this.handleCancelEvent}>
          <InvalidValue
            validTypes={validTypes}
            actualType={valueType}
            value={value}
            onChange={this.handleInvalidValue}
          />
        </div>
      )
    }
    const validation = markers.filter(marker => marker.type === 'validation')
    const errors = validation.filter(marker => marker.level === 'error')

    const classname = classNames([
      styles.root,
      editorValue.selection.focus.isInNode(node) && styles.focused,
      isSelected && styles.selected,
      errors.length > 0 && styles.hasErrors
    ])

    return (
      <span
        {...attributes}
        onDragStart={this.handleDragStart}
        onDragEnd={this.handleDragEnd}
        onDragEnter={this.handleCancelEvent}
        onDragLeave={this.handleCancelEvent}
        onDrop={this.handleCancelEvent}
        draggable={!readOnly}
        className={classname}
        onClick={this.handleShowMenu}
        suppressContentEditableWarning
        contentEditable="false"
      >
        <span ref={this.refPreviewContainer} className={styles.previewContainer}>
          {this.renderPreview(value)}
        </span>
      </span>
    )
  }
}
