"use client"

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { CameraIcon, PhotoIcon, XMarkIcon } from "@heroicons/react/24/outline"
import { useBodyScrollLock } from "@modules/layout/hooks/useBodyScrollLock"

type CameraAvailability = "unknown" | "available" | "unavailable"

interface VisualSearchCaptureProps {
  isOpen: boolean
  onClose: () => void
  onCapture: (_file: File) => void
}

export interface VisualSearchCaptureHandle {
  openCamera: () => void
  openGallery: () => void
}

const isTouchDevice = (): boolean =>
  (typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches) ||
  navigator.maxTouchPoints > 0

const VisualSearchCapture = forwardRef<
  VisualSearchCaptureHandle,
  VisualSearchCaptureProps
>(function VisualSearchCapture({ isOpen, onClose, onCapture }, ref) {
  const [cameraAvailability, setCameraAvailability] =
    useState<CameraAvailability>("unknown")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  useBodyScrollLock({ isLocked: isOpen || Boolean(errorMessage) })

  useEffect(() => {
    if (isTouchDevice()) {
      setCameraAvailability("available")
      return
    }

    if (!window.isSecureContext || !navigator.mediaDevices?.enumerateDevices) {
      setCameraAvailability("unavailable")
      return
    }

    let cancelled = false

    void navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (cancelled) return

        setCameraAvailability(
          devices.some((device) => device.kind === "videoinput")
            ? "available"
            : "unavailable"
        )
      })
      .catch(() => {
        if (!cancelled) {
          setCameraAvailability("unavailable")
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.currentTarget.files?.[0]
    event.currentTarget.value = ""

    if (!selectedFile) return

    onCapture(selectedFile)
  }

  const openCamera = useCallback(() => {
    if (cameraAvailability === "unavailable") {
      setErrorMessage(
        "You can't take a photo because this device does not have an available camera. Please connect a camera or choose a photo from Gallery."
      )
      onClose()
      return
    }

    setErrorMessage(null)
    onClose()
    cameraInputRef.current?.click()
  }, [cameraAvailability, onClose])

  const openGallery = useCallback(() => {
    setErrorMessage(null)
    onClose()
    galleryInputRef.current?.click()
  }, [onClose])

  useImperativeHandle(
    ref,
    () => ({
      openCamera,
      openGallery,
    }),
    [openCamera, openGallery]
  )

  return (
    <>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
        aria-label="Take a photo"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        aria-label="Choose an image from Gallery"
      />

      {isOpen && (
        <div
          className="fixed inset-0 z-[300] flex min-h-full items-center justify-center overflow-hidden overscroll-contain bg-slate-950/90 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="visual-search-capture-title"
        >
          <div className="my-auto flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4">
              <h2
                id="visual-search-capture-title"
                className="text-lg font-semibold text-slate-900"
              >
                Choose an Image
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close image capture"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
              <button
                type="button"
                onClick={openCamera}
                aria-label="Take a Photo"
                className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 px-4 py-4 text-left text-slate-900 transition hover:border-primary hover:bg-primary/5"
              >
                <CameraIcon className="h-7 w-7 text-primary" />
                <span>
                  <span className="block font-semibold">Take a Photo</span>
                  <span className="block text-sm text-slate-500">
                    Take a new product photo
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={openGallery}
                aria-label="Gallery"
                className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 px-4 py-4 text-left text-slate-900 transition hover:border-primary hover:bg-primary/5"
              >
                <PhotoIcon className="h-7 w-7 text-primary" />
                <span>
                  <span className="block font-semibold">
                    Choose from Gallery
                  </span>
                  <span className="block text-sm text-slate-500">
                    Choose an existing image
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {errorMessage && (
        <div
          className="fixed inset-0 z-[310] flex min-h-full items-center justify-center overflow-hidden overscroll-contain bg-black/40 p-4 "
          role="dialog"
          aria-modal="true"
          aria-labelledby="visual-search-camera-error-title"
        >
          <div className="w-full max-w-md rounded-3xl border border-primary/15 bg-white p-6 text-slate-900 shadow-2xl shadow-primary/10 sm:p-7">
            <h2
              id="visual-search-camera-error-title"
              className="text-xl font-semibold text-primary"
            >
              Camera not found
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-600" role="alert">
              {errorMessage}
            </p>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                OK, got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
})

VisualSearchCapture.displayName = "VisualSearchCapture"

export default VisualSearchCapture
