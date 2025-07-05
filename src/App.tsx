import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Mic, Square, Copy, Plus, Trash2, Settings, History } from 'lucide-react'
import { Button } from './components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './components/ui/dialog'
import { Input } from './components/ui/input'
import { ScrollArea } from './components/ui/scroll-area'
import { Separator } from './components/ui/separator'
import { Badge } from './components/ui/badge'
import { toast } from 'react-hot-toast'
import blink from './blink/client'

interface VoiceNote {
  id: string
  text: string
  original_text: string
  timestamp: number
  duration: number
}

interface DictionaryEntry {
  word: string
}

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [currentNote, setCurrentNote] = useState('')
  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([])
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([])
  const [newWord, setNewWord] = useState('')
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [recordingStart, setRecordingStart] = useState<number>(0)
  const [user, setUser] = useState<{ id: string; email: string } | null>(null)

  useEffect(() => {
    // Initialize auth and load data
    const initializeApp = async () => {
      try {
        const currentUser = await blink.auth.me()
        setUser(currentUser)
        loadVoiceNotes()
        loadDictionary()
      } catch (error) {
        console.error('Auth error:', error)
      }
    }

    initializeApp()
  }, [])

  const loadVoiceNotes = async () => {
    try {
      const notes = await blink.db.voice_notes.list({
        orderBy: { timestamp: 'desc' },
        limit: 50
      })
      setVoiceNotes(notes)
    } catch (error) {
      console.error('Error loading voice notes:', error)
    }
  }

  const loadDictionary = async () => {
    try {
      const entries = await blink.db.dictionary_entries.list({
        orderBy: { word: 'asc' }
      })
      setDictionary(entries)
    } catch (error) {
      console.error('Error loading dictionary:', error)
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      
      const chunks: Blob[] = []
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      }

      recorder.onstop = async () => {
        const duration = Date.now() - recordingStart
        await processRecording(chunks, duration)
      }

      setMediaRecorder(recorder)
      setRecordingStart(Date.now())
      recorder.start(100) // Collect data every 100ms
      setIsRecording(true)
      toast.success('Recording started')
    } catch (error) {
      console.error('Error starting recording:', error)
      toast.error('Failed to start recording')
    }
  }

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop()
      mediaRecorder.stream.getTracks().forEach(track => track.stop())
      setIsRecording(false)
      setIsTranscribing(true)
      toast.success('Recording stopped, transcribing...')
    }
  }

  const processRecording = async (audioChunks: Blob[], duration: number) => {
    try {
      // Verify we have audio data
      if (!audioChunks || audioChunks.length === 0) {
        throw new Error('No audio data recorded')
      }

      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })
      
      // Verify blob has content
      if (audioBlob.size === 0) {
        throw new Error('Audio recording is empty')
      }
      
      console.log('Audio blob size:', audioBlob.size, 'bytes')
      console.log('Number of chunks:', audioChunks.length)
       
      // Convert to base64 for transcription
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          const base64Data = dataUrl.split(',')[1]
          if (!base64Data || base64Data.length === 0) {
            reject(new Error('Failed to convert audio to base64'))
            return
          }
          resolve(base64Data)
        }
        reader.onerror = reject
        reader.readAsDataURL(audioBlob)
      })

      console.log('Base64 length:', base64.length)

      // Transcribe audio
      const { text: originalText } = await blink.ai.transcribeAudio({
        audio: base64,
        language: 'en'
      })

      // Compose preferred words prompt
      const preferredWords = dictionary.map(entry => entry.word).filter(Boolean)
      const processedText = originalText

      // Grammar correction and formatting, with preferred words
      const { text: correctedText } = await blink.ai.generateText({
        prompt: `You are transcribing a voice note for a user. Please correct grammar, improve formatting, and make this text more professional while preserving the original meaning and intent.
Here is the raw transcript:
"${processedText}"
The user has provided a list of special words and spellings they frequently use. When possible, prioritize using these words in the transcript:
${preferredWords.length ? preferredWords.join(', ') : '[none]'}
Rules:
- Fix grammar and spelling errors
- Improve sentence structure
- Add proper punctuation
- Make it more professional but keep the original tone
- Use the user's preferred words above if they fit the context
- Don't change the core meaning
- Return only the corrected text without explanations.`
      })

      const newNote: VoiceNote = {
        id: Date.now().toString(),
        text: correctedText,
        original_text: originalText,
        timestamp: Date.now(),
        duration: duration
      }

      // Save to database
      await blink.db.voice_notes.create({
        ...newNote,
        user_id: user.id
      })

      setCurrentNote(correctedText)
      setVoiceNotes(prev => [newNote, ...prev])
      setIsTranscribing(false)
      toast.success('Transcription completed!')
    } catch (error) {
      console.error('Error processing recording:', error)
      toast.error('Failed to process recording')
      setIsTranscribing(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard!')
  }

  const addDictionaryEntry = async () => {
    const word = newWord.trim()
    if (!word) return
    try {
      const entry = { word, user_id: user.id }
      await blink.db.dictionary_entries.create(entry)
      setDictionary(prev => [...prev, { word }])
      setNewWord('')
      toast.success('Word added!')
    } catch (error) {
      console.error('Error adding dictionary word:', error)
      toast.error('Failed to add word')
    }
  }

  const deleteDictionaryEntry = async (word: string) => {
    try {
      await blink.db.dictionary_entries.delete(word)
      setDictionary(prev => prev.filter(entry => entry.word !== word))
      toast.success('Word deleted!')
    } catch (error) {
      console.error('Error deleting dictionary word:', error)
      toast.error('Failed to delete word')
    }
  }

  const deleteNote = async (id: string) => {
    try {
      await blink.db.voice_notes.delete(id)
      setVoiceNotes(prev => prev.filter(note => note.id !== id))
      toast.success('Note deleted!')
    } catch (error) {
      console.error('Error deleting note:', error)
      toast.error('Failed to delete note')
    }
  }

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 p-4">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-slate-800 mb-2">AI Voice Notes</h1>
          <p className="text-slate-600">Smart transcription with custom dictionary</p>
        </header>

        {/* Main Recording Card */}
        <Card className="mb-8 bg-slate-50 border-0 shadow-[inset_-2px_-2px_6px_rgba(255,255,255,0.7),inset_2px_2px_6px_rgba(0,0,0,0.1)]">
          <CardContent className="p-8">
            <div className="flex flex-col items-center space-y-6">
              <motion.div
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="relative"
              >
                <Button
                  size="lg"
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isTranscribing}
                  className={`
                    w-20 h-20 rounded-full border-0 font-semibold text-white transition-all duration-300
                    ${isRecording 
                      ? 'bg-red-500 hover:bg-red-600 shadow-[inset_2px_2px_6px_rgba(0,0,0,0.2),inset_-2px_-2px_6px_rgba(255,255,255,0.1)]' 
                      : isTranscribing
                      ? 'bg-amber-500 shadow-[inset_2px_2px_6px_rgba(0,0,0,0.2),inset_-2px_-2px_6px_rgba(255,255,255,0.1)]'
                      : 'bg-blue-500 hover:bg-blue-600 shadow-[6px_6px_12px_rgba(0,0,0,0.1),-6px_-6px_12px_rgba(255,255,255,0.7)]'
                    }
                  `}
                >
                  {isTranscribing ? (
                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent" />
                  ) : isRecording ? (
                    <Square className="w-6 h-6" />
                  ) : (
                    <Mic className="w-6 h-6" />
                  )}
                </Button>
                
                {isRecording && (
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="absolute inset-0 rounded-full bg-red-500 opacity-30 pointer-events-none"
                  />
                )}
              </motion.div>

              <div className="text-center">
                <p className="text-lg font-medium text-slate-700">
                  {isTranscribing ? 'Transcribing...' : isRecording ? 'Recording...' : 'Tap to record'}
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  {isRecording ? 'Tap the stop button when finished' : 'Your voice will be automatically transcribed and formatted'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Current Note Display */}
        {currentNote && (
          <Card className="mb-8 bg-slate-50 border-0 shadow-[inset_-2px_-2px_6px_rgba(255,255,255,0.7),inset_2px_2px_6px_rgba(0,0,0,0.1)]">
            <CardHeader>
              <CardTitle className="text-slate-800">Latest Transcription</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-white rounded-lg p-4 shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.7)]">
                <p className="text-slate-700 leading-relaxed">{currentNote}</p>
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  onClick={() => copyToClipboard(currentNote)}
                  variant="outline"
                  className="bg-slate-100 border-0 shadow-[4px_4px_8px_rgba(0,0,0,0.1),-4px_-4px_8px_rgba(255,255,255,0.7)]"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Dictionary Management */}
          <Dialog>
            <DialogTrigger asChild>
              <Button className="h-14 bg-slate-200 text-slate-700 border-0 shadow-[6px_6px_12px_rgba(0,0,0,0.1),-6px_-6px_12px_rgba(255,255,255,0.7)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.7)]">
                <Settings className="w-5 h-5 mr-2" />
                Manage Dictionary ({dictionary.length})
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Preferred Words</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    addDictionaryEntry();
                  }}
                  className="flex gap-2"
                >
                  <Input
                    id="word"
                    value={newWord}
                    onChange={e => setNewWord(e.target.value)}
                    placeholder="Add a word (press Enter)"
                    autoFocus
                  />
                  <Button type="submit" variant="default">
                    <Plus className="w-4 h-4" />
                  </Button>
                </form>
                <Separator />
                <ScrollArea className="h-64">
                  <div className="space-y-2">
                    {dictionary.length === 0 && (
                      <div className="text-slate-400 text-sm text-center py-8">No preferred words yet.</div>
                    )}
                    {dictionary.map((entry) => (
                      <div key={entry.word} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                        <Badge variant="outline">{entry.word}</Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteDictionaryEntry(entry.word)}
                          aria-label={`Remove ${entry.word}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </DialogContent>
          </Dialog>

          {/* History */}
          <Dialog>
            <DialogTrigger asChild>
              <Button className="h-14 bg-slate-200 text-slate-700 border-0 shadow-[6px_6px_12px_rgba(0,0,0,0.1),-6px_-6px_12px_rgba(255,255,255,0.7)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.7)]">
                <History className="w-5 h-5 mr-2" />
                View History ({voiceNotes.length})
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle>Voice Notes History</DialogTitle>
              </DialogHeader>
              <ScrollArea className="h-[60vh]">
                <div className="space-y-4">
                  {voiceNotes.map((note) => (
                    <Card key={note.id} className="bg-slate-50">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center space-x-2 text-sm text-slate-500">
                            <span>{formatTimestamp(note.timestamp)}</span>
                            <span>•</span>
                            <span>{formatDuration(note.duration)}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => copyToClipboard(note.text)}
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => deleteNote(note.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-slate-700 leading-relaxed">{note.text}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  )
}

export default App