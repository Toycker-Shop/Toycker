"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CameraIcon, PhotoIcon, XMarkIcon } from "@heroicons/react/24/outline"
import { useBodyScrollLock } from "@modules/layout/hooks/useBodyScrollLock"

type CaptureView = "source" | "camera"
type CameraStatus = "idle" | "starting" | "ready" | "error"

interface VisualSearchCaptureProps {
  isOpen: boolean
  startWithCamera?: boolean
  onClose: () => void
  onCapture: (_file: File) => void
  onChooseGallery: () => void
}

function getCameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotFoundError":
        return "Camera not found. This device does not have an available camera. Please connect a camera or choose a photo from Gallery."
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "Camera access was denied. Please allow camera access in your browser settings or choose a photo from Gallery."
      case "NotReadableError":
        return "The camera is being used by another application. Close it and try again, or choose a photo from Gallery."
      case "OverconstrainedError":
        return "The requested camera is not available. Please choose a photo from Gallery."
      case "SecurityError":
        return "Camera access is not available in this browser context. Please choose a photo from Gallery."
      default:
        return "The camera could not be opened. Please choose a photo from Gallery."
    }
  }

  return "The camera could not be opened. Please choose a photo from Gallery."
}

export default function VisualSearchCapture({
  isOpen,
  startWithCamera = false,
  onClose,
  onCapture,
  onChooseGallery,
}: VisualSearchCaptureProps) {
  const [view, setView] = useState<CaptureView>("source")
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  useBodyScrollLock({ isLocked: isOpen })

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.srcObject = null
    }
  }, [])

  const closeCapture = useCallback(() => {
    stopStream()
    setView("source")
    setCameraStatus("idle")
    setErrorMessage(null)
    onClose()
  }, [onClose, stopStream])

  const chooseGallery = useCallback(() => {
    stopStream()
    onChooseGallery()
    onClose()
  }, [onChooseGallery, onClose, stopStream])

  const startCamera = useCallback(() => {
    setErrorMessage(null)
    setCameraStatus("starting")
    setView("camera")
  }, [])

  useEffect(() => {
    if (!isOpen) {
      stopStream()
      setView("source")
      setCameraStatus("idle")
      setErrorMessage(null)
      return
    }

    setView(startWithCamera ? "camera" : "source")
    setCameraStatus(startWithCamera ? "starting" : "idle")
    setErrorMessage(null)
  }, [isOpen, startWithCamera, stopStream])

  useEffect(() => {
    if (!isOpen || view !== "camera") return

    let cancelled = false

    const openCamera = async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setCameraStatus("error")
          setErrorMessage(
            "Camera access requires a secure browser connection. Please choose a photo from Gallery."
          )
        }
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream

        if (!videoRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          setCameraStatus("error")
          setErrorMessage(
            "The camera preview could not be prepared. Please choose a photo from Gallery."
          )
          return
        }

        videoRef.current.srcObject = stream
        await videoRef.current.play()

        if (!cancelled) {
          setCameraStatus("ready")
        }
      } catch (error) {
        if (!cancelled) {
          stopStream()
          setCameraStatus("error")
          setErrorMessage(getCameraErrorMessage(error))
        }
      }
    }

    void openCamera()

    return () => {
      cancelled = true
      stopStream()
    }
  }, [isOpen, stopStream, view])

  const capturePhoto = () => {
    const video = videoRef.current
    const canvas = canvasRef.current

    if (!video || !canvas || video.videoWidth <= 0 || video.videoHeight <= 0) {
      setCameraStatus("error")
      setErrorMessage("The camera is not ready yet. Please try again.")
      return
    }

    const context = canvas.getContext("2d")
    if (!context) {
      setCameraStatus("error")
      setErrorMessage(
        "The photo could not be captured. Please choose a photo from Gallery."
      )
      return
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraStatus("error")
          setErrorMessage(
            "The photo could not be captured. Please choose a photo from Gallery."
          )
          return
        }

        const file = new File([blob], "visual-search-camera.jpg", {
          type: "image/jpeg",
        })
        stopStream()
        onCapture(file)
        onClose()
      },
      "image/jpeg",
      0.92
    )
  }

  if (!isOpen) return null

  return (
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
            {view === "camera" ? "Take a Photo" : "Choose an Image"}
          </h2>
          <button
            type="button"
            onClick={closeCapture}
            className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close image capture"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {view === "source" ? (
          <div className="space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
            <button
              type="button"
              onClick={startCamera}
              aria-label="Camera"
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
              onClick={chooseGallery}
              aria-label="Gallery"
              className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 px-4 py-4 text-left text-slate-900 transition hover:border-primary hover:bg-primary/5"
            >
              <PhotoIcon className="h-7 w-7 text-primary" />
              <span>
                <span className="block font-semibold">Choose from Gallery</span>
                <span className="block text-sm text-slate-500">
                  Choose an existing image
                </span>
              </span>
            </button>
          </div>
        ) : (
          <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
            <div className="mx-auto w-full overflow-hidden rounded-2xl bg-slate-950">
              <video
                ref={videoRef}
                className="aspect-[4/3] max-h-[50dvh] w-full object-cover"
                autoPlay
                muted
                playsInline
                aria-label="Camera preview"
              />
            </div>

            {cameraStatus === "starting" && (
              <p className="text-center text-sm text-slate-500">
                Opening camera...
              </p>
            )}

            {errorMessage && (
              <p
                className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800"
                role="alert"
              >
                {errorMessage}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={capturePhoto}
                aria-label="Take photo"
                disabled={cameraStatus !== "ready"}
                className="rounded-xl bg-primary px-2 py-3 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:text-base"
              >
                Take a Photo
              </button>
              <button
                type="button"
                onClick={chooseGallery}
                aria-label="Gallery"
                className="rounded-xl border border-slate-200 px-2 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:px-4 sm:text-base"
              >
                Gallery
              </button>
            </div>

            <button
              type="button"
              onClick={closeCapture}
              className="w-full rounded-xl px-4 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            >
              Cancel
            </button>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
