import React from 'react'
import PropTypes from 'prop-types'
import {combineLatest, concat, of} from 'rxjs'
import {assignWith} from 'lodash'
import {map} from 'rxjs/operators'
import WarningIcon from 'part:@sanity/base/warning-icon'
import {observeForPreview, SanityDefaultPreview} from 'part:@sanity/base/preview'
import NotPublishedStatus from './NotPublishedStatus'
import DraftStatus from './DraftStatus'

const isLiveEditEnabled = schemaType => schemaType.liveEdit === true

const getStatusIndicator = (draft, published) => {
  if (draft) {
    return DraftStatus
  }
  return published ? null : NotPublishedStatus
}

const getMissingDocumentFallback = item => ({
  title: <span style={{fontStyle: 'italic'}}>{item.title || 'Missing document'}</span>,
  subtitle: (
    <span style={{fontStyle: 'italic'}}>
      {item.title ? `Missing document ID: ${item._id}` : `Document ID: ${item._id}`}
    </span>
  ),
  media: WarningIcon
})

const getValueWithFallback = ({value, draft, published}) => {
  const snapshot = draft || published
  if (!snapshot) {
    return getMissingDocumentFallback(value)
  }

  return assignWith({}, snapshot, value, (objValue, srcValue) => {
    return typeof srcValue === 'undefined' ? objValue : srcValue
  })
}

export default class DocumentPaneItemPreview extends React.Component {
  state = {}

  constructor(props) {
    super()
    const {value, schemaType} = props
    let sync = true
    this.subscription = concat(
      of({isLoading: true}),
      combineLatest([
        isLiveEditEnabled(schemaType)
          ? of({snapshot: null})
          : observeForPreview({...value, _id: `drafts.${value._id}`}, schemaType),
        observeForPreview(value, schemaType)
      ]).pipe(
        map(([draft, published]) => ({
          draft: draft.snapshot,
          published: published.snapshot,
          isLoading: false
        }))
      )
    ).subscribe(state => {
      if (sync) {
        this.state = state
      } else {
        this.setState(state)
      }
    })
    sync = false
  }

  componentWillUnmount() {
    if (this.subscription) {
      this.subscription.unsubscribe()
    }
  }

  render() {
    const {value, schemaType, layout, icon} = this.props
    const {draft, published, isLoading} = this.state

    return (
      <SanityDefaultPreview
        value={getValueWithFallback({isLoading, value, schemaType, draft, published})}
        isPlaceholder={isLoading}
        icon={icon || schemaType.icon}
        layout={layout}
        type={schemaType}
        status={isLoading ? null : getStatusIndicator(draft, published)}
      />
    )
  }
}

DocumentPaneItemPreview.propTypes = {
  layout: PropTypes.string,
  icon: PropTypes.func,
  value: PropTypes.object,
  schemaType: PropTypes.object
}
