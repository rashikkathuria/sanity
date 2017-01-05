import React, {PropTypes} from 'react'
import {StateLink} from 'part:@sanity/base/router'
import styles from './styles/ToolSwitcher.css'

class ToolSwitcher extends React.Component {
  static propTypes = {
    activeToolName: PropTypes.string,
    onClick: PropTypes.func,
    className: PropTypes.string,
    tools: PropTypes.arrayOf(
      PropTypes.shape({
        name: PropTypes.string.isRequired,
        icon: PropTypes.func.isRequired
      })
    )
  }

  render() {
    const {tools, activeToolName} = this.props
    return (
      <div className={`${styles.toolSwitcher} ${this.props.className}`}>
        <ul className={styles.toolList}>
          {tools.map(tool => {
            const itemClass = activeToolName === tool.name
              ? styles.activeItem
              : styles.item

            const ToolIcon = tool.icon

            return (
              <li key={tool.name} className={itemClass}>
                <StateLink className={styles.toolLink} state={{tool: tool.name}} onClick={this.props.onClick}>
                  <span className={styles.iconContainer}>
                    <ToolIcon />
                  </span>
                  <span className={styles.toolName}>
                    {tool.title || tool.name}
                  </span>
                </StateLink>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }
}

export default ToolSwitcher
