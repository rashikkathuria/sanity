// @flow

import type {Block, BlockArrayType, SlateValue, Marker, Type, Path} from './typeDefs'

import React from 'react'
import generateHelpUrl from '@sanity/generate-help-url'
import {uniq, flatten, debounce, unionBy} from 'lodash'
import FormField from 'part:@sanity/components/formfields/default'
import withPatchSubscriber from '../../utils/withPatchSubscriber'
import {PatchEvent} from '../../PatchEvent'
import InvalidValueInput from '../InvalidValueInput'
import {resolveTypeName} from '../../utils/resolveTypeName'
import Input from './Input'

import restoreSelection from './utils/restoreSelection'
import changeToPatches from './utils/changeToPatches'
import createSelectionOperation from './utils/createSelectionOperation'
import deserialize from './utils/deserialize'
import patchesToChange from './utils/patchesToChange'

import styles from './styles/SyncWrapper.css'

function findBlockType(type) {
  return type.of.find(ofType => ofType.name === 'block')
}

function isDeprecatedBlockSchema(type) {
  const blockType = findBlockType(type)
  if (blockType.span !== undefined) {
    return 'deprecatedSpan'
  }
  if (type.of.find(memberType => memberType.options && memberType.options.inline)) {
    return 'deprecatedInline'
  }
  return false
}

function isDeprecatedBlockValue(value) {
  if (!value || !Array.isArray(value)) {
    return false
  }
  const block = value.find(item => item._type === 'block')
  if (block && Object.keys(block).includes('spans')) {
    return true
  }
  return false
}

function isInvalidBlockValue(value) {
  if (Array.isArray(value)) {
    return false
  }
  if (typeof value === 'undefined') {
    return false
  }
  return true
}

const OPTIMIZED_OPERATION_TYPES = ['insert_text', 'remove_text']
const SEND_PATCHES_TOKEN_CHARS = [' ', '\n']

function isInsertOrRemoveTextOperations(operations) {
  return operations.map(op => op.type).every(opType => OPTIMIZED_OPERATION_TYPES.includes(opType))
}

type Props = {
  focusPath: [],
  markers: Marker[],
  onBlur: (nextPath: []) => void,
  onChange: PatchEvent => void,
  onFocus: (nextPath: []) => void,
  onPaste?: (
    event: SyntheticEvent<>,
    path: Path,
    type: Type,
    value: ?Value
  ) => {insert?: Value, path?: []},
  onPatch: (event: PatchEvent) => void,
  level: number,
  readOnly?: boolean,
  renderBlockActions?: (block: Block) => React.Node,
  renderCustomMarkers?: (Marker[]) => React.Node,
  schema: Schema,
  subscribe: (() => void) => void,
  type: BlockArrayType,
  value: Block[]
}

type State = {
  deprecatedSchema: boolean,
  deprecatedBlockValue: boolean,
  invalidBlockValue: boolean,
  editorValue: SlateValue,
  decorations: {anchor: {key: string, offset: number}}[],
  decorationHash: string
}

export default withPatchSubscriber(
  class SyncWrapper extends React.Component<Props, State> {
    _input = null
    _select = null
    _changes: []
    _undoRedoStack = {undo: [], redo: []}

    static defaultProps = {
      markers: []
    }

    // Keep track of what the editor value is (as seen in the editor) before it is changed by something.
    _beforeChangeEditorValue = null

    static getDerivedStateFromProps(nextProps, state) {
      // Make sure changes to markers are reflected in the editor value.
      // Slate heavily optimizes when nodes should re-render,
      // so we use decorators in Slate to force the relevant editor nodes to re-render
      // when markers change.
      const newDecorationHash = nextProps.markers.map(mrkr => JSON.stringify(mrkr.path)).join('')
      if (
        nextProps.markers &&
        nextProps.markers.length &&
        newDecorationHash !== state.decorationHash
      ) {
        const {editorValue} = state
        const decorations = unionBy(
          flatten(
            nextProps.markers.map(mrkr => {
              return mrkr.path.slice(0, 3).map(part => {
                const key = part._key
                if (!key) {
                  return null
                }
                return {
                  anchor: {key, offset: 0},
                  focus: {key, offset: 0},
                  mark: {type: '__marker'} // non-visible mark (we just want the block to re-render)
                }
              })
            })
          ).filter(Boolean),
          state.decorations,
          'focus.key'
        )
        const change = editorValue
          .change()
          .setOperationFlag('save', false)
          .setValue({decorations})
          .setOperationFlag('save', true)
        return {
          decorations,
          decorationHash: newDecorationHash,
          editorValue: change.value
        }
      }
      return null
    }

    constructor(props) {
      super(props)
      const {value, type} = props
      const deprecatedSchema = isDeprecatedBlockSchema(type)
      const deprecatedBlockValue = isDeprecatedBlockValue(value)
      const invalidBlockValue = isInvalidBlockValue(value)
      this.state = {
        deprecatedSchema,
        deprecatedBlockValue,
        editorValue:
          deprecatedSchema || deprecatedBlockValue || invalidBlockValue
            ? deserialize([], type)
            : deserialize(value, type),
        invalidBlockValue,
        decorations: [],
        decorationHash: ''
      }
      this.unsubscribe = props.subscribe(this.handleDocumentPatches)
      this._changes = []
    }

    handleEditorChange = (change: SlateChange, callback: void => void) => {
      const {value} = this.props
      const beforeChangeEditorValue = this.state.editorValue
      this._select = createSelectionOperation(change)
      this.setState({editorValue: change.value})
      this._changes.push({
        beforeChangeEditorValue,
        change,
        value
      })
      const insertOrRemoveTextOnly = isInsertOrRemoveTextOperations(change.operations)
      const text = change.operations.get(0) && change.operations.get(0).text
      const isTokenChar = insertOrRemoveTextOnly && text && SEND_PATCHES_TOKEN_CHARS.includes(text)
      if (!insertOrRemoveTextOnly || isTokenChar) {
        this.sendPatchesFromChange()
      } else {
        this.sendPatchesFromChangeDebounced()
      }
      if (callback) {
        callback(change)
        return change
      }
      return change
    }

    sendPatchesFromChangeDebounced = debounce(() => {
      this.sendPatchesFromChange()
    }, 1000)

    sendPatchesFromChange = () => {
      const {type, onChange} = this.props
      const finalPatches = []
      if (this._changes[0]) {
        this._beforeChangeEditorValue = this._changes[0].beforeChangeEditorValue
      }
      this._changes.forEach((changeSet, index) => {
        const {beforeChangeEditorValue, change, value} = changeSet
        const nextChangeSet = this._changes[index + 1]

        if (
          nextChangeSet &&
          isInsertOrRemoveTextOperations(
            nextChangeSet.change.operations.concat(changeSet.change.operations)
          )
        ) {
          // This patch will be redundant so skip it.
          return
        }
        const patches = changeToPatches(beforeChangeEditorValue, change, value, type)
        if (patches.length) {
          finalPatches.push(patches)
        }
      })
      const patchesToSend = flatten(finalPatches)
      if (patchesToSend.length) {
        onChange(PatchEvent.from(patchesToSend))
      }
      this._changes = []
    }

    handleFormBuilderPatch = (event: PatchEvent) => {
      const {onChange, type} = this.props
      const {editorValue} = this.state
      const change = patchesToChange(event.patches, editorValue, null, type)
      this.setState({editorValue: change.value})
      return onChange(event)
    }

    focus() {
      if (this._input) {
        this._input.focus()
      }
    }

    // eslint-disable-next-line complexity
    handleDocumentPatches = ({patches, shouldReset, snapshot}) => {
      const {type, focusPath} = this.props
      const hasRemotePatches = patches.some(patch => patch.origin === 'remote')
      const hasInsertUnsetPatches = patches.some(patch => ['insert', 'unset'].includes(patch.type))
      const hasMultipleDestinations =
        uniq(patches.map(patch => patch.path[0] && patch.path[0]._key).filter(Boolean)).length > 1
      const hasComplexity = patches.length > 3
      // Some heuristics for when we should set a new state or just trust that the editor
      // state is in sync with the formbuilder value. As setting a new state may be a performance
      // hog, we don't want to do it for the most basic changes (like entering a new character).
      // TODO: force sync the state every now and then just to be 100% sure we are in sync.
      const shouldSetNewState =
        hasRemotePatches ||
        hasInsertUnsetPatches ||
        hasMultipleDestinations ||
        hasComplexity ||
        shouldReset
      const localPatches = patches.filter(patch => patch.origin === 'local')

      // Handle undo/redo
      if (localPatches.length) {
        const lastPatch = localPatches.slice(-1)[0]
        // Until the FormBuilder can support some kind of patch tagging,
        // we create a void patch with key 'undoRedoVoidPatch' in changesToPatches
        // to know if this is undo/redo operation or not.
        const isUndoRedoPatch =
          lastPatch && lastPatch.path[0] && lastPatch.path[0]._key === 'undoRedoVoidPatch'
        const isEditorContentPatches = localPatches.every(patch => patch.path.length < 2)
        if (!isUndoRedoPatch && isEditorContentPatches) {
          this._undoRedoStack.undo.push({
            patches: localPatches,
            // Use the _beforeChangeEditorValue here, because at this point we could be
            // in the middle of changes, and the state.editorValue may be in a flux state
            editorValue: this._beforeChangeEditorValue,
            select: this._select
          })
          // Redo stack must be reset here
          this._undoRedoStack.redo = []
        }
      }

      // Set a new editorValue from the snapshot,
      // and restore the user's selection
      if (snapshot && shouldSetNewState) {
        const editorValue = deserialize(snapshot, type)
        const change = editorValue.change()
        if (this._select) {
          // eslint-disable-next-line max-depth
          try {
            restoreSelection(change, this._select, patches)
          } catch (err) {
            // eslint-disable-next-line max-depth
            if (!err.message.match('Could not find a descendant')) {
              console.error(err) // eslint-disable-line no-console
            }
          }
        }
        // Make sure to add any pending local operations (which is not sent as patches yet),
        //  to the new editorValue if this is incoming remote patches
        if (this._changes.length && patches.every(patch => patch.origin === 'remote')) {
          // eslint-disable-next-line max-depth
          try {
            this._changes.forEach(changeSet => {
              change.applyOperations(changeSet.change.operations)
            })
          } catch (err) {
            console.log('Could not apply pending local operations', err)
          }
        }
        // Keep the editor focused as we insert the new value
        if ((focusPath || []).length === 1) {
          change.focus()
        }
        this.setState({editorValue: change.value})
      }
    }

    handleOnLoading = (props = {}) => {
      const {loading} = this.state
      const _loading = {...loading, ...props}
      const isLoading = Object.keys(_loading).some(key => _loading[key])
      if (!isLoading) {
        setTimeout(() => {
          this.setState({isLoading, loading: _loading})
        }, 100)
        return
      }
      this.setState({isLoading, loading: _loading})
    }

    handleInvalidValue = () => {}

    refInput = (input: Input) => {
      this._input = input
    }

    // eslint-disable-next-line complexity
    render() {
      const {
        editorValue,
        deprecatedSchema,
        deprecatedBlockValue,
        invalidBlockValue,
        isLoading
      } = this.state
      const {onChange, ...rest} = this.props
      const {type, value, level} = this.props
      const isDeprecated = deprecatedSchema || deprecatedBlockValue
      return (
        <div className={styles.root}>
          {!isDeprecated &&
            !invalidBlockValue && (
              <Input
                level={level}
                editorValue={editorValue}
                onChange={this.handleEditorChange}
                isLoading={isLoading}
                onLoading={this.handleOnLoading}
                onPatch={this.handleFormBuilderPatch}
                undoRedoStack={this._undoRedoStack}
                sendPatchesFromChange={this.sendPatchesFromChange}
                ref={this.refInput}
                {...rest}
              />
            )}
          {invalidBlockValue && (
            <InvalidValueInput
              validTypes={type.of.map(mType => mType.name)}
              actualType={resolveTypeName(value)}
              value={value}
              onChange={this.handleInvalidValue}
            />
          )}
          {isDeprecated && (
            <FormField label={type.title}>
              <div className={styles.disabledEditor}>
                <strong>Heads up!</strong>
                <p>
                  You&apos;re using a new version of the Studio with
                  {deprecatedSchema && " a block schema that hasn't been updated."}
                  {deprecatedSchema &&
                    deprecatedBlockValue &&
                    ' Also block text needs to be updated.'}
                  {deprecatedBlockValue &&
                    !deprecatedSchema &&
                    " block text that hasn't been updated."}
                </p>
                {deprecatedSchema === 'deprecatedInline' && (
                  <p>
                    <a
                      href={generateHelpUrl('migrate-to-block-inline-types')}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      Migrate schema to block.children inline types
                    </a>
                  </p>
                )}
                {deprecatedSchema === 'deprecatedSpan' && (
                  <p>
                    <a
                      href={generateHelpUrl('migrate-to-block-children')}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      Migrate schema to block.children
                    </a>
                  </p>
                )}
              </div>
            </FormField>
          )}
        </div>
      )
    }
  }
)
