import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { CheckCircle, XCircle, RotateCcw, ArrowLeft, Camera, CameraOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { dismissalApi } from '../api/client'

const READER_ID = 'securepass-qr-reader'

export default function SecurePassScan() {
  const [status, setStatus] = useState('idle') // idle | scanning | verifying | success | error
  const [result, setResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [cameraError, setCameraError] = useState('')
  const scannerRef = useRef(null)
  const lastScannedRef = useRef('')

  const startScanner = async () => {
    setStatus('scanning')
    setResult(null)
    setErrorMsg('')
    setCameraError('')
    lastScannedRef.current = ''

    try {
      const cameras = await Html5Qrcode.getCameras()
      if (!cameras || cameras.length === 0) {
        setCameraError('No camera detected on this device.')
        setStatus('idle')
        return
      }
      const cameraId = cameras.find(c => /back|rear|environment/i.test(c.label))?.id || cameras[0].id

      const html5QrCode = new Html5Qrcode(READER_ID)
      scannerRef.current = html5QrCode

      await html5QrCode.start(
        cameraId,
        { fps: 10, qrbox: { width: 250, height: 250 } },
        handleScan,
        () => {} // onScanFailure - intentionally silent to avoid spam
      )
    } catch (err) {
      console.error('Scanner start error:', err)
      setCameraError(err?.message || 'Unable to access camera. Check browser permissions.')
      setStatus('idle')
    }
  }

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop()
        }
        await scannerRef.current.clear()
      } catch (err) {
        console.warn('Scanner stop error:', err)
      }
      scannerRef.current = null
    }
  }

  const handleScan = async (decodedText) => {
    if (decodedText === lastScannedRef.current) return
    lastScannedRef.current = decodedText
    setStatus('verifying')
    await stopScanner()

    try {
      const res = await dismissalApi.verify({ qrPayload: decodedText })
      setResult(res.data)
      setStatus('success')
      toast.success('Student released!')
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'Verification failed.')
      setStatus('error')
    }
  }

  const rescan = () => {
    setResult(null)
    setErrorMsg('')
    startScanner()
  }

  useEffect(() => {
    startScanner()
    return () => { stopScanner() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link to="/securepass" className="p-2 rounded-lg hover:bg-slate-100 text-slate-600">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="page-title">Scan SecurePass QR</h1>
          <p className="page-subtitle">Point the camera at the guardian's pass</p>
        </div>
      </div>

      <div className="card p-4 sm:p-6 max-w-lg mx-auto">
        {/* Reader mount */}
        <div
          id={READER_ID}
          className={`rounded-xl overflow-hidden bg-slate-900 ${status === 'scanning' ? 'block' : 'hidden'}`}
          style={{ minHeight: 300 }}
        />

        {/* Status cards */}
        {status === 'verifying' && (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-sm text-slate-600">Verifying QR…</span>
          </div>
        )}

        {status === 'success' && result && (
          <div className="py-6">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
                <CheckCircle size={36} className="text-emerald-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Student Released</h3>
              <p className="text-sm text-slate-600 mt-1">{result.student}</p>
              <p className="text-xs text-slate-500 mt-0.5">Released to {result.authorizedGuardian}</p>
            </div>
            <button onClick={rescan} className="btn-primary w-full justify-center mt-6">
              <RotateCcw size={15} /> Scan Next
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="py-6">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-3">
                <XCircle size={36} className="text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Verification Failed</h3>
              <p className="text-sm text-red-600 mt-1">{errorMsg}</p>
            </div>
            <button onClick={rescan} className="btn-primary w-full justify-center mt-6">
              <RotateCcw size={15} /> Try Again
            </button>
          </div>
        )}

        {status === 'idle' && cameraError && (
          <div className="py-6">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-3">
                <CameraOff size={36} className="text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Camera Unavailable</h3>
              <p className="text-sm text-slate-500 mt-1 max-w-xs">{cameraError}</p>
              <p className="text-xs text-slate-400 mt-2">Make sure you're on HTTPS and have granted camera permission.</p>
            </div>
            <button onClick={startScanner} className="btn-secondary w-full justify-center mt-6">
              <Camera size={15} /> Retry Camera
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
