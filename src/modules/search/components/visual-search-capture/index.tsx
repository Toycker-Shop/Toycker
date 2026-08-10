"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CameraIcon, PhotoIcon, XMarkIcon } from "@heroicons/react/24/outline"

type CaptureView = "source" | "camera"
type CameraStatus = "idle" | "starting" | "ready" | "error"

interface VisualSearchCaptureProps {
  isOpen: boolean
  onClose: () => void
  onCapture: (_file: File) => void
  onChooseGallery: () => void
}

export function isCoarsePointerDevice(): boolean {
  if (typeof window === "undefined") return false

  return window.matchMedia("(pointer: coarse)").matches
}

function getCameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "Camera access was denied. You can choose a photo from your gallery instead."
      case "NotFoundError":
        return "No camera was found on this device. You can choose a photo from your gallery instead."
      case "NotReadableError":
        return "The camera is being used by another app. You can choose a photo from your gallery instead."
      case "SecurityError":
        return "Camera access is not available in this browser context. You can choose a photo from your gallery instead."
      case "OverconstrainedError":
        return "The requested camera is not available. You can choose a photo from your gallery instead."
      default:
        return "The camera could not be opened. You can choose a photo from your gallery instead."
    }
  }

  return "The camera could not be opened. You can choose a photo from your gallery instead."
}

export default function VisualSearchCapture({
  isOpen,
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
    onClose()
    onChooseGallery()
  }, [onChooseGallery, onClose, stopStream])

  const startCamera = useCallback(() => {
    setErrorMessage(null)
    setCameraStatus("starting")
    setView("camera")
  }, [])

  useEffect(() => {
    if (!isOpen || view !== "camera") return

    let cancelled = false

    const openCamera = async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setCameraStatus("error")
          setErrorMessage("Camera access requires a secure, supported browser. You can choose a photo from your gallery instead.")
        }
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
          },
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
          setErrorMessage("The camera preview could not be prepared. You can choose a photo from your gallery instead.")
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

  useEffect(() => {
    if (!isOpen) {
      stopStream()
      setView("source")
      setCameraStatus("idle")
      setErrorMessage(null)
    }
  }, [isOpen, stopStream])

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
      setErrorMessage("The photo could not be captured. You can choose a photo from your gallery instead.")
      return
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraStatus("error")
        setErrorMessage("The photo could not be captured. You can choose a photo from your gallery instead.")
        return
      }

      const file = new File([blob], "visual-search-camera.jpg", { type: "image/jpeg" })
      stopStream()
      onCapture(file)
      onClose()
    }, "image/jpeg", 0.92)
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="visual-search-capture-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 id="visual-search-capture-title" className="text-lg font-semibold text-slate-900">
            {view === "camera" ? "Take a photo" : "Choose an image"}
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
          <div className="space-y-4 p-5">
            {errorMessage && (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
                {errorMessage}
              </p>
            )}

            <button
              type="button"
              onClick={startCamera}
              aria-label="Camera"
              className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 px-4 py-4 text-left text-slate-900 transition hover:border-primary hover:bg-primary/5"
            >
              <CameraIcon className="h-7 w-7 text-primary" />
              <span>
                <span className="block font-semibold">Camera</span>
                <span className="block text-sm text-slate-500">Take a new product photo</span>
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
                <span className="block font-semibold">Gallery</span>
                <span className="block text-sm text-slate-500">Choose an existing image</span>
              </span>
            </button>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="overflow-hidden rounded-2xl bg-slate-950">
              <video
                ref={videoRef}
                className="aspect-[3/4] w-full object-cover"
                autoPlay
                muted
                playsInline
                aria-label="Camera preview"
              />
            </div>

            {cameraStatus === "starting" && (
              <p className="text-center text-sm text-slate-500">Opening camera…</p>
            )}

            {errorMessage && (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
                {errorMessage}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={capturePhoto}
                disabled={cameraStatus !== "ready"}
                className="rounded-xl bg-primary px-4 py-3 font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Take photo
              </button>
              <button
                type="button"
                onClick={chooseGallery}
                className="rounded-xl border border-slate-200 px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
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
