import { useEffect } from "react"

interface UseBodyScrollLockOptions {
  isLocked: boolean
}

interface BodyScrollLockState {
  count: number
  scrollY: number
  bodyOverflow: string
  bodyPaddingRight: string
  bodyPosition: string
  bodyTop: string
  bodyWidth: string
  bodyOverscrollBehavior: string
  htmlOverflow: string
  htmlOverscrollBehavior: string
  hadModalOpenClass: boolean
}

let activeLock: BodyScrollLockState | null = null

export const useBodyScrollLock = ({ isLocked }: UseBodyScrollLockOptions): void => {
  useEffect(() => {
    if (!isLocked) return

    if (activeLock) {
      activeLock.count += 1

      return () => {
        if (!activeLock) return

        activeLock.count -= 1
        if (activeLock.count > 0) return

        const completedLock = activeLock
        activeLock = null
        restoreScrollLock(completedLock)
      }
    }

    const body = document.body
    const html = document.documentElement
    const scrollbarWidth = window.innerWidth - html.clientWidth

    activeLock = {
      count: 1,
      scrollY: window.scrollY,
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
      htmlOverflow: html.style.overflow,
      htmlOverscrollBehavior: html.style.overscrollBehavior,
      hadModalOpenClass: body.classList.contains("modal-open"),
    }

    html.style.overflow = "hidden"
    html.style.overscrollBehavior = "none"
    body.style.overflow = "hidden"
    body.style.overscrollBehavior = "none"
    body.style.position = "fixed"
    body.style.top = `-${activeLock.scrollY}px`
    body.style.width = "100%"
    body.style.paddingRight = `${scrollbarWidth}px`
    body.classList.add("modal-open")

    return () => {
      if (!activeLock) return

      activeLock.count -= 1
      if (activeLock.count > 0) return

      const completedLock = activeLock
      activeLock = null
      restoreScrollLock(completedLock)
    }
  }, [isLocked])
}

const restoreScrollLock = (state: BodyScrollLockState): void => {
  const body = document.body
  const html = document.documentElement

  body.style.overflow = state.bodyOverflow
  body.style.paddingRight = state.bodyPaddingRight
  body.style.position = state.bodyPosition
  body.style.top = state.bodyTop
  body.style.width = state.bodyWidth
  body.style.overscrollBehavior = state.bodyOverscrollBehavior
  html.style.overflow = state.htmlOverflow
  html.style.overscrollBehavior = state.htmlOverscrollBehavior

  if (state.hadModalOpenClass) {
    body.classList.add("modal-open")
  } else {
    body.classList.remove("modal-open")
  }

  if (state.scrollY !== 0) {
    window.scrollTo(0, state.scrollY)
  }
}