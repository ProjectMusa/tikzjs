class GroupChecker {
  _stack: string[] = []
  _scopeStack: string[] = []
  _currentStack: string[] = this._stack
  checkValid(trial: string): boolean {
    // check trial string can be pushed into stack
    console.log(`check with ${trial}`)

    if (trial === '$') {
      return (
        this._currentStack === this._stack ||
        (this._currentStack === this._scopeStack && this._scopeStack.length === 1 && this._scopeStack.at(-1) === '$')
      )
    } else if (trial === '\\(') {
      return this._currentStack === this._stack
    } else if (trial === '\\)') {
      return this._currentStack === this._scopeStack && this._scopeStack.at(-1) === '\\('
    } else if (trial === 'lbrace') {
      return true
    } else if (trial === 'rbrace') {
      return this._currentStack.at(-1) === 'lbrace'
    } else if (trial.startsWith('@env_b_')) {
      return true
    } else if (trial.startsWith('@env_e_')) {
      return this._currentStack.at(-1) === trial.replace('@env_e_', '@env_b_')
    }
    return false
  }
  toggleMathScope(mStr: string): string | undefined {
    if (!this.checkValid(mStr)) return
    let snap = this._currentStack.join(',')
    if (this._currentStack === this._stack) {
      this._scopeStack.push(mStr)
      this._currentStack = this._scopeStack
    } else {
      this._scopeStack.pop()
      this._currentStack = this._stack
    }
    return snap
  }

  beginGroup(lStr: string): string | undefined {
    console.log(`begin group with ${lStr}`)
    if (!this.checkValid(lStr)) return
    let snap = this._currentStack.join(',')
    this._currentStack.push(lStr)
    return snap
  }
  endGroup(rStr: string): string | undefined {
    console.log(`try to end group ${this._currentStack.at(-1)} with ${rStr}`)
    if (!this.checkValid(rStr)) return
    this._currentStack.pop()
    let snap = this._currentStack.join(',')
    return snap
  }
}

export const group_checker = new GroupChecker()
