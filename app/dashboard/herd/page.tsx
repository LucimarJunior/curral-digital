'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import { 
  Fingerprint, 
  Package, 
  History, 
  ChevronRight, 
  Plus, 
  Mars, 
  Venus, 
  Info,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  ChevronDown,
  ArrowLeft,
  TrendingUp,
  Activity,
  FileUp,
  Sheet,
  Download,
  X
} from 'lucide-react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import TruTestImportPreview from '@/components/trutest-import-preview'
import DashboardLayout from '@/components/dashboard-layout'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface Cattle {
  id: string;
  tag_number: string;
  name?: string;
  electronic_id?: string;
  breed?: string;
  category?: string;
  weight_kg?: number;
  pasture?: string;
  status?: string;
  gender?: 'Male' | 'Female';
  mother_id?: string;
  father_id?: string;
  birth_date?: string;
  inserted_at: string;
}

interface Pasture {
  id: string;
  farm_id: string;
  name: string;
  description?: string;
  area_ha?: number;
  capacity?: number;
  status: string;
}

interface Semen {
  id: string;
  farm_id: string;
  bull_name: string;
  bull_breed: string;
  dose_count: number;
  provider?: string;
  notes?: string;
}

interface Weighing {
  id: string;
  weight_kg: number;
  inserted_at: string;
  notes?: string;
}

interface HealthRecord {
  id: string;
  record_type: string;
  medication?: string;
  description?: string;
  inserted_at: string;
}

export default function HerdPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = React.useState<'list' | 'form' | 'details' | 'pastures' | 'semen'>('list')
  const [loading, setLoading] = React.useState(false)
  const [listLoading, setListLoading] = React.useState(true)
  const [cattleList, setCattleList] = React.useState<Cattle[]>([])
  const [stats, setStats] = React.useState({
    total: 0,
    avgWeight: 0,
    healthStatus: '94%'
  })
  
  const [status, setStatus] = React.useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = React.useState('')
  const [isImporting, setIsImporting] = React.useState(false)
  const [importLoading, setImportLoading] = React.useState(false)
  const [importProgress, setImportProgress] = React.useState({ current: 0, total: 0 })
  const [importResults, setImportResults] = React.useState<{ success: number, error: number, details: string[] } | null>(null)
  const [sex, setSex] = React.useState<'Male' | 'Female'>('Male')
  const [selectedFarmId, setSelectedFarmId] = React.useState<string | null>(null)
  const [selectedAnimal, setSelectedAnimal] = React.useState<Cattle | null>(null)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [pastureFilter, setPastureFilter] = React.useState('Todos')
  const [breedFilter, setBreedFilter] = React.useState('Todas')
  const [statusFilter, setStatusFilter] = React.useState('Todos')
  const [searchingParent, setSearchingParent] = React.useState({
    mother: false,
    father: false
  })
  const [weightHistory, setWeightHistory] = React.useState<Weighing[]>([])
  const [loadingHistory, setLoadingHistory] = React.useState(false)
  const [lastReproEvent, setLastReproEvent] = React.useState<any>(null)
  const [loadingRepro, setLoadingRepro] = React.useState(false)
  const [healthHistory, setHealthHistory] = React.useState<HealthRecord[]>([])
  const [loadingHealth, setLoadingHealth] = React.useState(false)
  const [parentMatch, setParentMatch] = React.useState<{
    mother: Cattle | null,
    father: Cattle | null
  }>({
    mother: null,
    father: null
  })

  const [parentDetails, setParentDetails] = React.useState<{
    motherAnimal: Cattle | null,
    fatherAnimal: Cattle | null,
    grandMotherMaterna: Cattle | null,
    grandFatherMaterno: Cattle | null,
  }>({
    motherAnimal: null,
    fatherAnimal: null,
    grandMotherMaterna: null,
    grandFatherMaterno: null,
  })
  const [loadingGenealogy, setLoadingGenealogy] = React.useState(false)

  // Smart Reproductive Status States & Functions
  const [offspringList, setOffspringList] = React.useState<Cattle[]>([])
  const [weaningEventsList, setWeaningEventsList] = React.useState<any[]>([])
  const [loadingOffspring, setLoadingOffspring] = React.useState(false)

  const fetchOffspringAndWeaning = React.useCallback(async (cowTagNumber: string) => {
    if (!isSupabaseConfigured() || !selectedFarmId) return
    setLoadingOffspring(true)
    try {
      const { data: offspring, error: oError } = await supabase
        .from('cattle')
        .select('*')
        .eq('farm_id', selectedFarmId)
        .eq('mother_id', cowTagNumber)
        .order('birth_date', { ascending: false })

      if (oError) throw oError

      const list = (offspring || []) as Cattle[]
      setOffspringList(list)

      if (list.length > 0) {
        const ids = list.map(item => item.id)
        const { data: weanData, error: wError } = await (supabase.from('reproduction_events') as any)
          .select('*')
          .eq('farm_id', selectedFarmId)
          .eq('event_type', 'weaning')
          .in('cattle_id', ids)

        if (wError) throw wError
        setWeaningEventsList(weanData || [])
      } else {
        setWeaningEventsList([])
      }
    } catch (err) {
      console.error('Error fetching offspring/weaning:', err)
    } finally {
      setLoadingOffspring(false)
    }
  }, [selectedFarmId])

  const [reproToast, setReproToast] = React.useState<{type: 'success' | 'error', message: string} | null>(null)

  const [isEditingPasture, setIsEditingPasture] = React.useState(false)
  const [selectedPastureVal, setSelectedPastureVal] = React.useState('')
  const [savingPasture, setSavingPasture] = React.useState(false)

  const handleUpdatePasture = async () => {
    if (!selectedAnimal || !selectedFarmId || !isSupabaseConfigured()) return
    setSavingPasture(true)
    try {
      const { error } = await (supabase.from('cattle') as any)
        .update({ pasture: selectedPastureVal || null })
        .eq('id', selectedAnimal.id)

      if (error) throw error

      // Update local state
      setSelectedAnimal(prev => prev ? { ...prev, pasture: selectedPastureVal || undefined } : null)
      setReproToast({ type: 'success', message: 'Lote/Pasto atualizado com sucesso!' })
      // Auto dismiss success toast after 4 seconds
      setTimeout(() => setReproToast(null), 4000)

      setIsEditingPasture(false)
      // Refresh general list
      await fetchCattle(selectedFarmId)
    } catch (err: any) {
      console.error('Error updating pasture:', err)
      setReproToast({ type: 'error', message: 'Erro ao atualizar lote/pasto: ' + err.message })
    } finally {
      setSavingPasture(false)
    }
  }

  const handleRegisterWeaning = async (calfId: string) => {
    if (!isSupabaseConfigured() || !selectedFarmId) {
      setReproToast({ type: 'error', message: 'Configuração inválida ou Fazenda não selecionada.' })
      return
    }

    try {
      const calf = offspringList.find(c => c.id === calfId);
      const calfTag = calf?.tag_number || 'Sem brinco';
      const newCategory = (calf && calf.gender === 'Female') ? 'Novilha' : 'Garrote';

      const eventData = {
        cattle_id: calfId,
        farm_id: selectedFarmId,
        event_type: 'weaning',
        status: 'weaned',
        notes: `Desmame registrado. Categoria alterada para ${newCategory}.`
      };

      const { error: eventError } = await (supabase.from('reproduction_events') as any).insert(eventData)
      if (eventError) throw eventError

      const { error: updateError } = await (supabase.from('cattle') as any)
        .update({ category: newCategory })
        .eq('id', calfId)

      if (updateError) throw updateError

      setReproToast({ 
        type: 'success', 
        message: `Desmame registrado com sucesso! O bezerro de brinco "${calfTag}" agora foi desmamado e sua categoria atualizada para "${newCategory}".` 
      })

      // Auto dismiss success toast after 5 seconds
      setTimeout(() => {
        setReproToast(null)
      }, 5000)

      if (selectedAnimal) {
        await fetchReproductiveStatus(selectedAnimal.id)
        await fetchOffspringAndWeaning(selectedAnimal.tag_number)
      }
      await fetchCattle(selectedFarmId)

    } catch (err: any) {
      console.error('Error registering weaning:', err)
      setReproToast({ type: 'error', message: 'Erro ao registrar desmame: ' + err.message })
    }
  }

  const categoryOptions = {
    Male: [
      { value: 'Bezerro', label: 'Bezerro' },
      { value: 'Garrote', label: 'Garrote' },
      { value: 'Boi', label: 'Boi' }
    ],
    Female: [
      { value: 'Bezerra', label: 'Bezerra' },
      { value: 'Novilha', label: 'Novilha' },
      { value: 'Vaca', label: 'Vaca' }
    ]
  }

  const [formData, setFormData] = React.useState({
    tag_number: '',
    electronic_id: '',
    birth_date: '',
    category: 'Bezerro',
    breed: '',
    weight_kg: '',
    pasture: '',
    mother_id: '',
    father_id: ''
  })

  const [duplicates, setDuplicates] = React.useState({
    tag_number: false,
    electronic_id: false
  })

  // Memoized Filtered List
  const filteredCattle = React.useMemo(() => {
    return cattleList.filter(animal => {
      const matchPasture = pastureFilter === 'Todos' || animal.pasture === pastureFilter
      const matchBreed = breedFilter === 'Todas' || animal.breed === breedFilter
      const matchStatus = statusFilter === 'Todos' || 
        (statusFilter === 'Vacinado' && animal.status === 'Active') ||
        (statusFilter === 'Pendente' && animal.status !== 'Active')
      
      return matchPasture && matchBreed && matchStatus
    })
  }, [cattleList, pastureFilter, breedFilter, statusFilter])

  // Get Unique Filter Options
  const filterOptions = React.useMemo(() => {
    const pastures = Array.from(new Set(cattleList.map(a => a.pasture).filter(Boolean))) as string[]
    const breeds = Array.from(new Set(cattleList.map(a => a.breed).filter(Boolean))) as string[]
    return { pastures, breeds }
  }, [cattleList])

  // Fetch Cattle List
  const fetchCattle = React.useCallback(async (farmId: string) => {
    if (!isSupabaseConfigured()) return
    setListLoading(true)
    try {
      const { data, error } = await supabase
        .from('cattle')
        .select('*')
        .eq('farm_id', farmId)
        .order('inserted_at', { ascending: false })

      if (error) throw error
      
      const cattleData = (data || []) as Cattle[]
      setCattleList(cattleData)
      
      // Calculate Stats
      if (cattleData.length > 0) {
        const totalWeight = cattleData.reduce((acc, curr) => acc + (curr.weight_kg || 0), 0)
        const avg = (totalWeight / cattleData.length).toFixed(1)
        setStats({
          total: cattleData.length,
          avgWeight: Number(avg),
          healthStatus: '98%' // Static for now as schema doesn't have health status yet fully
        })
      }
    } catch (err) {
      console.error('Error fetching cattle:', err)
    } finally {
      setListLoading(false)
    }
  }, [])

  const [pasturesList, setPasturesList] = React.useState<Pasture[]>([])

  const fetchPastures = React.useCallback(async (farmId: string) => {
    if (!isSupabaseConfigured()) return
    try {
      const { data, error } = await (supabase.from('pastures') as any)
        .select('*')
        .eq('farm_id', farmId)
        .eq('status', 'Active')
        .order('name')

      if (error) {
        if (error.code === '42P01') return // Table doesn't exist yet
        throw error
      }
      
      const pasturesData = (data || []) as Pasture[]
      setPasturesList(pasturesData)
      
      // Update default pasture if list is not empty and current is empty
      if (pasturesData.length > 0 && !formData.pasture) {
        setFormData(prev => ({ ...prev, pasture: pasturesData[0].name }))
      }
    } catch (err) {
      console.error('Error fetching pastures:', err)
    }
  }, [formData.pasture])

  const fetchWeightHistory = React.useCallback(async (animalId: string) => {
    if (!isSupabaseConfigured()) return
    setLoadingHistory(true)
    try {
      const { data, error } = await supabase
        .from('weighings')
        .select('*')
        .eq('cattle_id', animalId)
        .order('inserted_at', { ascending: false })

      if (error) {
        if (error.code === '42P01') {
          setWeightHistory([])
          return
        }
        throw error
      }
      setWeightHistory(data || [])
    } catch (err) {
      console.error('Error fetching weight history:', err)
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  const fetchReproductiveStatus = React.useCallback(async (animalId: string) => {
    if (!isSupabaseConfigured()) return
    setLoadingRepro(true)
    try {
      const { data, error } = await supabase
        .from('reproduction_events')
        .select('*')
        .eq('cattle_id', animalId)
        .order('inserted_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        if (error.code === '42P01') {
          setLastReproEvent(null)
          return
        }
        throw error
      }
      setLastReproEvent(data)
    } catch (err) {
      console.error('Error fetching reproductive status:', err)
    } finally {
      setLoadingRepro(false)
    }
  }, [])

  const fetchHealthHistory = React.useCallback(async (animalId: string) => {
    if (!isSupabaseConfigured()) return
    setLoadingHealth(true)
    try {
      const { data, error } = await supabase
        .from('health_records')
        .select('*')
        .eq('cattle_id', animalId)
        .order('inserted_at', { ascending: false })
        .limit(5)

      if (error) {
        if (error.code === '42P01') {
          setHealthHistory([])
          return
        }
        throw error
      }
      setHealthHistory(data || [])
    } catch (err) {
      console.error('Error fetching health history:', err)
    } finally {
      setLoadingHealth(false)
    }
  }, [])

  React.useEffect(() => {
    if (selectedAnimal && activeTab === 'details') {
      const timer = setTimeout(() => {
        setSelectedPastureVal(selectedAnimal.pasture || '')
        setIsEditingPasture(false)
        fetchWeightHistory(selectedAnimal.id)
        fetchReproductiveStatus(selectedAnimal.id)
        fetchHealthHistory(selectedAnimal.id)
        if (selectedAnimal.gender === 'Female') {
          fetchOffspringAndWeaning(selectedAnimal.tag_number)
        }
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [selectedAnimal, activeTab, fetchWeightHistory, fetchReproductiveStatus, fetchHealthHistory, fetchOffspringAndWeaning])

  React.useEffect(() => {
    if (!selectedAnimal || !selectedFarmId || !isSupabaseConfigured() || activeTab !== 'details') {
      const timer = setTimeout(() => {
        setParentDetails({
          motherAnimal: null,
          fatherAnimal: null,
          grandMotherMaterna: null,
          grandFatherMaterno: null,
        })
      }, 0)
      return () => clearTimeout(timer)
    }

    const timer = setTimeout(() => {
      const fetchParents = async () => {
        setLoadingGenealogy(true)
        try {
          let motherAnimal: Cattle | null = null
          let fatherAnimal: Cattle | null = null
          let grandMotherMaterna: Cattle | null = null
          let grandFatherMaterno: Cattle | null = null

          // 1. Fetch Mother if mother_id is set
          if (selectedAnimal.mother_id) {
            const { data: mData } = await (supabase.from('cattle') as any)
              .select('*')
              .eq('farm_id', selectedFarmId)
              .eq('tag_number', selectedAnimal.mother_id)
              .maybeSingle()
            
            if (mData) {
              motherAnimal = mData as Cattle
              // Fetch Maternal Grandparents if Mother exists and has parents
              if (motherAnimal.mother_id) {
                const { data: gmMData } = await (supabase.from('cattle') as any)
                  .select('*')
                  .eq('farm_id', selectedFarmId)
                  .eq('tag_number', motherAnimal.mother_id)
                  .maybeSingle()
                if (gmMData) grandMotherMaterna = gmMData as Cattle
              }
              if (motherAnimal.father_id) {
                const { data: gmFData } = await (supabase.from('cattle') as any)
                  .select('*')
                  .eq('farm_id', selectedFarmId)
                  .eq('tag_number', motherAnimal.father_id)
                  .maybeSingle()
                if (gmFData) grandFatherMaterno = gmFData as Cattle
              }
            }
          }

          // 2. Fetch Father if father_id is set
          if (selectedAnimal.father_id) {
            const { data: fData } = await (supabase.from('cattle') as any)
              .select('*')
              .eq('farm_id', selectedFarmId)
              .eq('tag_number', selectedAnimal.father_id)
              .maybeSingle()
            
            if (fData) {
              fatherAnimal = fData as Cattle
            }
          }

          setParentDetails({
            motherAnimal,
            fatherAnimal,
            grandMotherMaterna,
            grandFatherMaterno,
          })
        } catch (err) {
          console.error('Erro ao buscar genealogia:', err)
        } finally {
          setLoadingGenealogy(false)
        }
      }

      fetchParents()
    }, 0)

    return () => clearTimeout(timer)
  }, [selectedAnimal, selectedFarmId, activeTab])

  React.useEffect(() => {
    const farmId = localStorage.getItem('selectedFarmId')
    if (!farmId) {
      router.push('/dashboard')
      return
    }
    
    // Defer state updates to avoid cascading renders warning
    const timer = setTimeout(() => {
      setSelectedFarmId(farmId)
      fetchCattle(farmId)
      fetchPastures(farmId)
    }, 0)
    
    return () => clearTimeout(timer)
  }, [router, fetchCattle, fetchPastures])

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const query = searchQuery.trim().toUpperCase()
      if (!query) return

      const animal = cattleList.find(
        a => a.tag_number.toUpperCase() === query || 
             (a.electronic_id && a.electronic_id.toUpperCase() === query)
      )

      if (animal) {
        setSelectedAnimal(animal)
        setActiveTab('details')
        setSearchQuery('')
      } else {
        alert('Animal não pertence ao rebanho')
      }
    }
  }

  const lookupParent = async (type: 'mother' | 'father', value: string) => {
    if (!value || !selectedFarmId || !isSupabaseConfigured()) return
    
    setSearchingParent(prev => ({ ...prev, [type]: true }))
    try {
      const gender = type === 'mother' ? 'Female' : 'Male'
      const { data, error } = await supabase
        .from('cattle')
        .select('*')
        .eq('farm_id', selectedFarmId)
        .eq('gender', gender)
        .or(`tag_number.eq.${value},electronic_id.eq.${value}`)
        .maybeSingle()

      if (data) {
        setParentMatch(prev => ({ ...prev, [type]: data as Cattle }))
      } else {
        setParentMatch(prev => ({ ...prev, [type]: null }))
      }
    } catch (err) {
      console.error(`Error looking up ${type}:`, err)
    } finally {
      setSearchingParent(prev => ({ ...prev, [type]: false }))
    }
  }

  const checkDuplicate = async (field: 'tag_number' | 'electronic_id', value: string) => {
    if (!value || !selectedFarmId || !isSupabaseConfigured()) return

    try {
      let query = supabase.from('cattle').select('id')
      
      if (field === 'tag_number') {
        query = query.eq('tag_number', value).eq('farm_id', selectedFarmId)
      } else {
        query = query.eq('electronic_id', value)
      }

      const { data, error } = await query.maybeSingle()
      
      if (data) {
        setDuplicates(prev => ({ ...prev, [field]: true }))
      } else {
        setDuplicates(prev => ({ ...prev, [field]: false }))
      }
    } catch (err) {
      console.error(`Error checking duplicate ${field}:`, err)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { id, value } = e.target
    setFormData(prev => ({ ...prev, [id]: value }))
    
    if (id === 'category') {
      if (['Vaca', 'Novilha', 'Bezerra'].includes(value)) {
        setSex('Female')
      } else if (['Boi', 'Garrote', 'Touro', 'Bezerro'].includes(value)) {
        setSex('Male')
      }
    }

    if (id === 'tag_number' || id === 'electronic_id') {
      setDuplicates(prev => ({ ...prev, [id]: false }))
    }
  }

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    
    if (!isSupabaseConfigured()) {
      setStatus('error')
      setErrorMessage('Supabase não está configurado. Por favor, configure as variáveis de ambiente.')
      return
    }

    if (!formData.tag_number) {
      setStatus('error')
      setErrorMessage('O ID Visual (Brinco) é obrigatório.')
      return
    }

    setLoading(true)
    setStatus('idle')

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      if (!user) throw new Error('Usuário não autenticado. Por favor, faça login novamente.')

      if (!selectedFarmId) {
        throw new Error('Nenhuma fazenda selecionada. Volte para a lista de fazendas.')
      }

      // Check Rule #4: Can only calve again if previous calf has been weaned (desmamado)
      if (formData.mother_id) {
        const { data: motherOffspring, error: moError } = await (supabase.from('cattle') as any)
          .select('id, tag_number')
          .eq('farm_id', selectedFarmId)
          .eq('mother_id', formData.mother_id)

        if (moError) throw moError

        if (motherOffspring && motherOffspring.length > 0) {
          const offspringIds = (motherOffspring as any[]).map(o => o.id)
          const { data: weaningEvents, error: wError } = await (supabase.from('reproduction_events') as any)
            .select('cattle_id')
            .eq('farm_id', selectedFarmId)
            .eq('event_type', 'weaning')
            .in('cattle_id', offspringIds)

          if (wError) throw wError

          const weanedIds = weaningEvents ? (weaningEvents as any[]).map(we => we.cattle_id) : []
          const unweanedCalf = (motherOffspring as any[]).find(o => !weanedIds.includes(o.id))

          if (unweanedCalf) {
            throw new Error(`Esta vaca já possui um bezerro ativo e não desmamado (Brinco: ${unweanedCalf.tag_number}). Ela só poderá parir novamente se o bezerro anterior for desmamado primeiro.`);
          }
        }
      }

      const parseNum = (val: string) => {
        const parsed = parseFloat(val)
        return isNaN(parsed) ? null : parsed
      }

      const cattleData: any = {
        owner_id: user.id,
        farm_id: selectedFarmId,
        tag_number: formData.tag_number,
        electronic_id: formData.electronic_id || null,
        name: formData.tag_number,
        breed: formData.breed || null,
        category: formData.category || null,
        pasture: formData.pasture || null,
        mother_id: formData.mother_id || null,
        father_id: formData.father_id || null,
        birth_date: formData.birth_date || null,
        gender: sex,
        weight_kg: formData.weight_kg ? parseNum(formData.weight_kg) : null,
        status: 'Active'
      }

      const { error: insertError } = await (supabase.from('cattle') as any).insert(cattleData)

      if (insertError) throw insertError

      setStatus('success')
      // Reset relevant fields
      setParentMatch({ mother: null, father: null })
      setFormData(prev => ({
        ...prev,
        tag_number: '',
        electronic_id: '',
        weight_kg: '',
        mother_id: '',
        father_id: '',
      }))
      
      // Refresh list
      fetchCattle(selectedFarmId)
      
      // Switch to list after a brief delay if user prefers
      // setTimeout(() => setActiveTab('list'), 1500)
    } catch (err: any) {
      console.error('Error saving cattle:', err)
      let message = 'Ocorreu um erro ao registrar o animal.'
      if (err.code === '23505') {
        message = 'Já existe um registro com este IDV nesta fazenda ou este IDE globalmente.'
      } else if (err.message) {
        message = err.message
      }
      setStatus('error')
      setErrorMessage(message)
    } finally {
      setLoading(false)
    }
  }

  const handleImportCattle = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !isSupabaseConfigured()) return

    if (!selectedFarmId) {
      setErrorMessage('Nenhuma fazenda selecionada. Volte para a lista de fazendas.')
      setStatus('error')
      return
    }

    setImportLoading(true)
    setImportResults(null)
    setImportProgress({ current: 0, total: 0 })

    const processCattleData = async (data: any[]) => {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (userError) throw userError
        if (!user) throw new Error('Usuário não autenticado.')

        setImportProgress({ current: 0, total: data.length })
        let successCount = 0
        let errorCount = 0
        const details: string[] = []

        const seenTagNumbers = new Set<string>()
        const seenElectronicIds = new Set<string>()

        for (let i = 0; i < data.length; i++) {
          const row = data[i]
          try {
            const tagNumber = String(row.IDV || row.IDV_Brinco || row.brinco || row.tag_number || row.IDV_brinco || '').trim()
            const electronicId = String(row.IDE || row.brinco_eletronico || row.electronic_id || row.IDE_Eletronico || '').trim()
            
            if (!tagNumber && !electronicId) {
              throw new Error('Registro sem IDV ou IDE.')
            }

            // Check if already seen in current spreadsheet context to prevent duplicate self-submission
            if (tagNumber && seenTagNumbers.has(tagNumber)) {
              errorCount++
              details.push(`Linha ${i + 1}: Brinco (IDV) "${tagNumber}" duplicado na própria planilha. Registro ignorado.`)
              continue
            }
            if (electronicId && seenElectronicIds.has(electronicId)) {
              errorCount++
              details.push(`Linha ${i + 1}: Brinco Eletrônico (IDE) "${electronicId}" duplicado na própria planilha. Registro ignorado.`)
              continue
            }

            if (tagNumber) seenTagNumbers.add(tagNumber)
            if (electronicId) seenElectronicIds.add(electronicId)

            // Gender mapping
            const rawGender = String(row.Sexo || row.sexo || row.gender || row.Sex || '').trim().toUpperCase()
            let resolvedGender: 'Male' | 'Female' | null = null
            if (rawGender.startsWith('F') || rawGender.includes('FEM') || rawGender === 'FÊMEA' || rawGender === 'FÉMEA' || rawGender.includes('MULHER')) {
              resolvedGender = 'Female'
            } else if (rawGender.startsWith('M') || rawGender.includes('MAC') || rawGender === 'MACHO') {
              resolvedGender = 'Male'
            }

            // Category mapping
            const category = String(row.Categoria || row.categoria || row.category || '').trim()

            // Date of birth
            const rawBirthDate = String(row['Data de Nascimento'] || row.data_nascimento || row.birth_date || row.Nascimento || '').trim()
            let birthDate: string | null = null
            if (rawBirthDate) {
              try {
                let fmtDate = rawBirthDate
                if (rawBirthDate.includes('/')) {
                  const parts = rawBirthDate.split('/')
                  if (parts.length === 3) {
                    fmtDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
                  }
                }
                const testDate = new Date(fmtDate)
                if (!isNaN(testDate.getTime())) {
                  birthDate = testDate.toISOString().split('T')[0]
                }
              } catch (e) {
                console.warn('Erro ao ler data de nascimento:', rawBirthDate)
              }
            }

            const motherId = String(row.Mãe || row.mae || row.mother || row.Brinco_Mae || '').trim()
            const fatherId = String(row.Pai || row.pai || row.father || row.Brinco_Pai || '').trim()
            const breed = String(row.Raça || row.raca || row.breed || row.Race || '').trim()
            const weight = parseFloat(String(row.Peso || row.peso || row.weight || '0').replace(',', '.'))
            const pasture = String(row.Pasto || row.pasto || row.Lote || row.lote || row['Lote/Pasto'] || row.pasture || '').trim()
            const notes = String(row['observações'] || row.observacoes || row.obs || row.notes || '').trim()

            // Database Duplicate check - Prohibit duplicates
            let animalQuery = (supabase.from('cattle') as any).select('id, tag_number, electronic_id').eq('farm_id', selectedFarmId)
            if (tagNumber && electronicId) {
              animalQuery = animalQuery.or(`tag_number.eq."${tagNumber}",electronic_id.eq."${electronicId}"`)
            } else if (tagNumber) {
              animalQuery = animalQuery.eq('tag_number', tagNumber)
            } else {
              animalQuery = animalQuery.eq('electronic_id', electronicId)
            }

            const { data: existingAnimals, error: findError } = await animalQuery
            if (findError) throw findError

            if (existingAnimals && existingAnimals.length > 0) {
              const matched = existingAnimals[0]
              const duplicateDesc = (tagNumber && matched.tag_number === tagNumber)
                ? `Brinco (IDV) "${tagNumber}"`
                : `Eletrônico (IDE) "${electronicId}"`
              
              errorCount++
              details.push(`Linha ${i + 1}: Animal com ${duplicateDesc} já existe cadastrado nesta fazenda. Cadastro impedido para evitar duplicidade.`)
              continue
            }

            // Create new animal
            const insertPayload: any = {
              farm_id: selectedFarmId,
              owner_id: user.id,
              tag_number: tagNumber || `AUTO-${Date.now()}`,
              electronic_id: electronicId || null,
              name: tagNumber || electronicId,
              gender: resolvedGender,
              category: category || null,
              birth_date: birthDate,
              mother_id: motherId || null,
              father_id: fatherId || null,
              breed: breed || null,
              weight_kg: weight > 0 ? weight : null,
              pasture: pasture || null,
              status: 'Active'
            }

            const { data: newAnimal, error: createError } = await (supabase
              .from('cattle') as any)
              .insert(insertPayload)
              .select('id')
              .single()

            if (createError) throw createError
            const animalId = (newAnimal as any).id

            // Record weight in weighings table if specified
            if (weight > 0) {
              const { error: weightError } = await (supabase.from('weighings') as any).insert({
                cattle_id: animalId,
                farm_id: selectedFarmId,
                weight_kg: weight,
                notes: notes || 'Pesagem importada no cadastro inicial do animal.',
                inserted_at: new Date().toISOString()
              })
              if (weightError) throw weightError
            }

            successCount++
          } catch (err: any) {
            console.error(`Error processing row ${i + 1}:`, err)
            errorCount++
            details.push(`Linha ${i + 1}: ${err.message || 'Erro ao processar linha'}`)
          }
          setImportProgress(prev => ({ ...prev, current: i + 1 }))
        }

        setImportResults({ success: successCount, error: errorCount, details })
        setImportLoading(false)
        fetchCattle(selectedFarmId)
      } catch (err: any) {
        console.error('Error in import process:', err)
        setErrorMessage(err.message || 'Ocorreu um erro no processador de importação.')
        setImportLoading(false)
      }
    }

    if (file.name.endsWith('.csv')) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          processCattleData(results.data)
        },
        error: (err) => {
          setErrorMessage(`Erro ao ler CSV: ${err.message}`)
          setImportLoading(false)
        }
      })
    } else {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer)
          const workbook = XLSX.read(data, { type: 'array' })
          const firstSheetName = workbook.SheetNames[0]
          const worksheet = workbook.Sheets[firstSheetName]
          const jsonData = XLSX.utils.sheet_to_json(worksheet)
          processCattleData(jsonData)
        } catch (err: any) {
          setErrorMessage(`Erro ao ler Excel: ${err.message}`)
          setImportLoading(false)
        }
      }
      reader.readAsArrayBuffer(file)
    }
  }

  const downloadCattleTemplate = () => {
    const headers = ['IDV', 'IDE', 'Sexo', 'Categoria', 'Data de Nascimento', 'Mãe', 'Pai', 'Raça', 'Peso', 'Lote/Pasto', 'observações']
    const sampleRow = ['BR-1002', '982000223456781', 'Fêmea', 'Novilha', '20/10/2023', 'MAE-99', 'TOURO-02', 'Nelore', '310.5', 'Pasto Sul', 'Primeira cria registrada']
    
    // Semicolon compatibility for excel
    const csvContent = [
      headers.join(';'),
      sampleRow.join(';')
    ].join('\n')
    
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', 'modelo_importacao_animais.csv')
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const [pastureFormData, setPastureFormData] = React.useState({
    name: '',
    description: '',
    area_ha: '',
    capacity: ''
  })
  const [pastureStatus, setPastureStatus] = React.useState<'idle' | 'success' | 'error'>('idle')
  const [pastureErrorMessage, setPastureErrorMessage] = React.useState('')

  const handlePastureChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target
    setPastureFormData(prev => ({ ...prev, [id]: value }))
  }

  const handleSavePasture = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    
    if (!isSupabaseConfigured()) {
      setPastureStatus('error')
      setPastureErrorMessage('Supabase não está configurado.')
      return
    }

    if (!pastureFormData.name) {
      setPastureStatus('error')
      setPastureErrorMessage('O nome do lote/pasto é obrigatório.')
      return
    }

    setLoading(true)
    setPastureStatus('idle')

    try {
      if (!selectedFarmId) throw new Error('Nenhuma fazenda selecionada.')

      const { error: insertError } = await (supabase.from('pastures') as any)
        .insert({
          farm_id: selectedFarmId,
          name: pastureFormData.name,
          description: pastureFormData.description || null,
          area_ha: pastureFormData.area_ha ? parseFloat(pastureFormData.area_ha) : null,
          capacity: pastureFormData.capacity ? parseInt(pastureFormData.capacity) : null,
          status: 'Active'
        })

      if (insertError) {
        if (insertError.code === '42P01') {
          throw new Error('Tabela "pastures" não encontrada no Supabase. Por favor, execute o SQL de criação.')
        }
        throw insertError
      }

      setPastureStatus('success')
      setPastureFormData({
        name: '',
        description: '',
        area_ha: '',
        capacity: ''
      })
      
      // Refresh list
      if (selectedFarmId) fetchPastures(selectedFarmId)
    } catch (err: any) {
      console.error('Error saving pasture:', err)
      setPastureStatus('error')
      setPastureErrorMessage(err.message || 'Erro ao registrar lote/pasto.')
    } finally {
      setLoading(false)
    }
  }

  const [semenFormData, setSemenFormData] = React.useState({
    bull_name: '',
    bull_breed: 'NELORE',
    dose_count: '',
    provider: '',
    notes: ''
  })
  const [semenStatus, setSemenStatus] = React.useState<'idle' | 'success' | 'error'>('idle')
  const [semenErrorMessage, setSemenErrorMessage] = React.useState('')

  const handleSemenChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { id, value } = e.target
    setSemenFormData(prev => ({ ...prev, [id]: value }))
  }

  const handleSaveSemen = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    
    if (!isSupabaseConfigured()) {
      setSemenStatus('error')
      setSemenErrorMessage('Supabase não está configurado.')
      return
    }

    if (!semenFormData.bull_name) {
      setSemenStatus('error')
      setSemenErrorMessage('O nome do touro é obrigatório.')
      return
    }

    setLoading(true)
    setSemenStatus('idle')

    try {
      if (!selectedFarmId) throw new Error('Nenhuma fazenda selecionada.')

      const { error: insertError } = await (supabase.from('semen_tank') as any)
        .insert({
          farm_id: selectedFarmId,
          bull_name: semenFormData.bull_name,
          bull_breed: semenFormData.bull_breed,
          dose_count: semenFormData.dose_count ? parseInt(semenFormData.dose_count) : 0,
          provider: semenFormData.provider || null,
          notes: semenFormData.notes || null
        })

      if (insertError) throw insertError

      setSemenStatus('success')
      setSemenFormData({
        bull_name: '',
        bull_breed: 'NELORE',
        dose_count: '',
        provider: '',
        notes: ''
      })
    } catch (err: any) {
      console.error('Error saving semen:', err)
      setSemenStatus('error')
      setSemenErrorMessage(err.message || 'Erro ao registrar sêmen.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Page Header & Tabs */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-4xl font-bold text-primary tracking-tight">Curral Digital</h2>
              <p className="text-outline font-medium mt-1">Gestão inteligente do seu rebanho</p>
            </div>
            {activeTab === 'list' && (
              <button 
                onClick={() => setActiveTab('form')}
                className="px-6 py-3 bg-primary text-white rounded-xl font-bold flex items-center gap-2 hover:brightness-110 transition-all shadow-lg shadow-primary/10"
              >
                <Plus className="w-5 h-5" /> Cadastrar Animal
              </button>
            )}
          </div>
          
          <div className="flex border-b border-outline-variant overflow-x-auto no-scrollbar">
            <button 
              onClick={() => setActiveTab('list')}
              className={cn(
                "px-8 py-4 font-bold transition-all border-b-2 whitespace-nowrap",
                activeTab === 'list' ? "text-primary border-primary" : "text-outline hover:text-on-surface border-transparent"
              )}
            >
              Animais
            </button>
            <button 
              onClick={() => setActiveTab('details')}
              className={cn(
                "px-8 py-4 font-bold transition-all border-b-2 whitespace-nowrap",
                activeTab === 'details' ? "text-primary border-primary" : "text-outline hover:text-on-surface border-transparent"
              )}
            >
              Ficha Individual
            </button>
            <button 
              onClick={() => setActiveTab('form')}
              className={cn(
                "px-8 py-4 font-bold transition-all border-b-2 whitespace-nowrap",
                activeTab === 'form' ? "text-primary border-primary" : "text-outline hover:text-on-surface border-transparent"
              )}
            >
              Cadastro
            </button>
            <button 
              onClick={() => setActiveTab('pastures')}
              className={cn(
                "px-8 py-4 font-bold transition-all border-b-2 whitespace-nowrap",
                activeTab === 'pastures' ? "text-primary border-primary" : "text-outline hover:text-on-surface border-transparent"
              )}
            >
              Lote/Pasto
            </button>
            <button 
              onClick={() => setActiveTab('semen')}
              className={cn(
                "px-8 py-4 font-bold transition-all border-b-2 whitespace-nowrap",
                activeTab === 'semen' ? "text-primary border-primary" : "text-outline hover:text-on-surface border-transparent"
              )}
            >
              Botijão Sêmen
            </button>
          </div>
        </div>

        {activeTab === 'list' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
          >
            {/* Filters & Search Card */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
                <div className="md:col-span-1">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-outline block mb-2">Pesquisar IDV/IDE</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline w-4 h-4" />
                    <input 
                      className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-outline-variant rounded-xl text-sm font-medium focus:border-primary focus:ring-4 focus:ring-primary/5 outline-none transition-all" 
                      placeholder="Ex: 4502..." 
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={handleSearch}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-bold text-outline block mb-2">Lote / Pasto</label>
                  <div className="relative">
                    <select 
                      value={pastureFilter}
                      onChange={(e) => setPastureFilter(e.target.value)}
                      className="w-full py-2.5 pl-4 pr-10 bg-surface-container-low border border-outline-variant rounded-xl text-sm font-medium focus:border-primary outline-none transition-all appearance-none"
                    >
                      <option value="Todos">Todos os Lotes</option>
                      {filterOptions.pastures.map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-outline w-4 h-4 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-bold text-outline block mb-2">Raça</label>
                  <div className="relative">
                    <select 
                      value={breedFilter}
                      onChange={(e) => setBreedFilter(e.target.value)}
                      className="w-full py-2.5 pl-4 pr-10 bg-surface-container-low border border-outline-variant rounded-xl text-sm font-medium focus:border-primary outline-none transition-all appearance-none"
                    >
                      <option value="Todas">Todas as Raças</option>
                      {filterOptions.breeds.map(b => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-outline w-4 h-4 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-bold text-outline block mb-2">Status</label>
                  <div className="relative">
                    <select 
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="w-full py-2.5 pl-4 pr-10 bg-surface-container-low border border-outline-variant rounded-xl text-sm font-medium focus:border-primary outline-none transition-all appearance-none"
                    >
                      <option value="Todos">Todos os Status</option>
                      <option value="Vacinado">Vacinado</option>
                      <option value="Pendente">Pendente</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-outline w-4 h-4 pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>

            {/* Data Table */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-surface-container-low border-b border-outline-variant">
                    <tr>
                      <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-outline">IDV/IDE</th>
                      <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-outline">Raça</th>
                      <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-outline">Categoria</th>
                      <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-outline">Peso (kg)</th>
                      <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-outline">Pasto Atual</th>
                      <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-outline">Status</th>
                      <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-outline text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {listLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          <td colSpan={7} className="px-6 py-4"><div className="h-4 bg-surface-container-high rounded w-full"></div></td>
                        </tr>
                      ))
                    ) : filteredCattle.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-20 text-center text-outline font-medium">Nenhum animal encontrado com os filtros aplicados.</td>
                      </tr>
                    ) : (
                      filteredCattle.map((animal) => (
                        <tr 
                          key={animal.id} 
                          className="hover:bg-surface-container transition-colors group cursor-pointer"
                          onClick={() => {
                            setSelectedAnimal(animal)
                            setActiveTab('details')
                          }}
                        >
                          <td className="px-6 py-4">
                            <div className="font-bold text-primary">{animal.tag_number}</div>
                            <div className="text-[9px] text-outline truncate w-24">IDE: {animal.electronic_id || 'N/A'}</div>
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-on-surface-variant">{animal.breed || 'NELORE'}</td>
                          <td className="px-6 py-4">
                            <span className="text-[10px] font-bold px-2 py-1 bg-surface-container-high rounded-lg text-outline uppercase tracking-wider">
                              {animal.category}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-mono font-bold text-primary">{animal.weight_kg || '0.0'} kg</td>
                          <td className="px-6 py-4 text-sm font-medium text-on-surface-variant">{animal.pasture || 'Pasto A'}</td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                              animal.status === 'Active' ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                            )}>
                              {animal.status === 'Active' ? 'Vacinado' : 'Pendente'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button 
                              className="text-primary hover:underline text-xs font-bold inline-flex items-center gap-1"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedAnimal(animal)
                                setActiveTab('details')
                              }}
                            >
                              Ver Detalhes <ChevronRight className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-6 py-4 bg-surface-container-low border-t border-outline-variant flex items-center justify-between">
                <span className="text-xs font-bold text-outline uppercase tracking-widest">
                  Mostrando {filteredCattle.length} de {cattleList.length} animais
                </span>
                <div className="flex gap-2">
                  <button className="p-2 border border-outline-variant rounded-lg hover:bg-surface-container-high transition-colors disabled:opacity-50" disabled>
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <button className="p-2 border border-outline-variant rounded-lg hover:bg-surface-container-high transition-colors disabled:opacity-50" disabled>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-primary-container p-8 rounded-2xl border border-primary/10 relative overflow-hidden group">
                <div className="relative z-10">
                  <p className="text-on-primary-container text-[10px] font-bold uppercase tracking-widest opacity-80">Total Rebanho</p>
                  <h3 className="text-5xl font-bold text-white mt-2">{stats.total.toLocaleString()}</h3>
                  <div className="mt-4 flex items-center text-on-primary-container text-xs font-bold">
                    <Plus className="w-3 h-3 mr-1" />
                    <span>+{cattleList.filter(a => new Date(a.inserted_at).getMonth() === new Date().getMonth()).length} este mês</span>
                  </div>
                </div>
                <div className="absolute -right-4 -bottom-4 opacity-10 group-hover:scale-110 transition-transform duration-500">
                  <Package className="w-32 h-32 text-white" />
                </div>
              </div>

              <div className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant relative overflow-hidden group">
                <div className="relative z-10">
                  <p className="text-outline text-[10px] font-bold uppercase tracking-widest">Média de Peso</p>
                  <h3 className="text-5xl font-bold text-primary mt-2">{stats.avgWeight}<span className="text-lg ml-1 font-medium text-outline">kg</span></h3>
                  <p className="mt-4 text-outline text-xs font-bold">Variação estável última semana</p>
                </div>
                <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform duration-500">
                  <History className="w-32 h-32" />
                </div>
              </div>

              <div className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant relative overflow-hidden group">
                <div className="relative z-10">
                  <p className="text-outline text-[10px] font-bold uppercase tracking-widest">Sanidade em Dia</p>
                  <h3 className="text-5xl font-bold text-secondary mt-2">{stats.healthStatus}</h3>
                  <p className="mt-4 text-outline text-xs font-bold">75 animais requerem atenção</p>
                </div>
                <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform duration-500">
                  <CheckCircle2 className="w-32 h-32" />
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'form' && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="max-w-4xl mx-auto pb-20"
          >
            <div className="flex justify-between items-center mb-10">
              <h2 className="text-4xl font-bold text-primary tracking-tight">Novo Registro</h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsImporting(!isImporting)
                    setImportResults(null)
                  }}
                  className={cn(
                    "px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 border cursor-pointer",
                    isImporting 
                      ? "bg-surface-container-high border-outline-variant text-on-surface hover:brightness-95" 
                      : "bg-surface-container-lowest border-primary/25 text-primary hover:bg-primary/5"
                  )}
                >
                  <Sheet className="w-4 h-4" />
                  {isImporting ? "Cadastro Manual" : "Importar Planilha"}
                </button>
                {!isImporting && (
                  <button 
                    onClick={handleSave}
                    disabled={loading}
                    className="px-8 py-3 bg-primary text-white rounded-xl font-bold shadow-lg flex items-center gap-2 hover:brightness-110 disabled:opacity-70"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Salvar Animal
                  </button>
                )}
              </div>
            </div>

            {/* Success/Error Alerts */}
            {status === 'success' && !isImporting && (
              <div className="mb-8 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3 text-green-700">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <p className="font-semibold">Animal registrado com sucesso!</p>
              </div>
            )}
            {status === 'error' && !isImporting && (
              <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Ops! Algo deu errado</p>
                  <p className="text-sm font-medium">{errorMessage}</p>
                </div>
              </div>
            )}

            {isImporting ? (
              <div className="space-y-6">
                <TruTestImportPreview farmId={selectedFarmId} pastures={pasturesList} />
                <details className="rounded-2xl border border-outline-variant">
                  <summary className="cursor-pointer p-5 font-bold text-on-surface">Importação convencional (modelo completo)</summary>
              <section className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant shadow-sm space-y-8">
                <div className="flex items-center justify-between border-b border-outline-variant pb-4">
                  <div className="flex items-center gap-3">
                    <FileUp className="text-primary w-5 h-5" />
                    <h3 className="text-xl font-bold text-on-surface">Importar Animais</h3>
                  </div>
                  <button 
                    onClick={downloadCattleTemplate}
                    type="button"
                    className="flex items-center gap-2 text-xs font-bold text-primary hover:text-primary/80 transition-colors bg-primary/5 px-3 py-1.5 rounded-xl border border-primary/20 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Baixar Modelo Completo
                  </button>
                </div>

                <div className="bg-surface-container-low p-6 rounded-2xl space-y-3">
                  <h4 className="text-sm font-bold text-on-surface">Dados suportados na planilha de importação:</h4>
                  <p className="text-xs text-outline font-medium leading-relaxed">
                    Sua planilha Excel (.xlsx) ou CSV deve conter as seguintes colunas (mesma grafia): <br />
                    <code className="bg-surface-container-high px-2 py-1 rounded text-primary font-bold">IDV</code> (Brinco de identificação visual), <br />
                    <code className="bg-surface-container-high px-2 py-1 rounded text-primary font-bold">IDE</code> (Brinco ou chip eletrônico), <br />
                    <code className="bg-surface-container-high px-2 py-1 rounded text-primary font-bold">Sexo</code> (Macho ou Fêmea), <br />
                    <code className="bg-surface-container-high px-2 py-1 rounded text-primary font-bold">Categoria</code> (Bezerro, Novilha, Vaca, Bovino, etc), <br />
                    <code className="bg-surface-container-high px-2 py-1 rounded text-primary font-bold">Data de Nascimento</code> (D/M/Y ou Y-M-D), <br />
                    <code className="bg-surface-container-high px-2 py-1 rounded text-primary font-bold">Mãe</code>, <br />
                    <code className="bg-surface-container-high px-2 py-1 rounded text-primary font-bold">Pai</code>, <br />
                    <code className="bg-surface-container-high px-2 py-1 rounded text-primary font-bold">Raça</code> (Ex: Nelore, Angus, etc), <br />
                    <code className="bg-surface-container-high px-2 py-1 rounded text-primary font-bold">Peso</code> (Peso do animal em kg), <br />
                    <code className="bg-surface-container-high px-2 py-1 rounded text-primary font-bold">Lote/Pasto</code> (Nome do Lote/Pasto do animal), <br />
                    <code className="bg-surface-container-high px-2 py-1 rounded text-primary font-bold">observações</code>
                  </p>
                  <p className="text-xs text-amber-700 font-bold bg-amber-50 p-2.5 rounded-lg border border-amber-200/50">
                    ⚠️ NOTA: Registros repetidos com o mesmo IDV ou IDE que já existam cadastrados nesta fazenda serão bloqueados de forma a não permitir qualquer duplicidade.
                  </p>
                </div>

                {!importResults ? (
                  !importLoading ? (
                    <div className="relative">
                      <input 
                        type="file" 
                        accept=".csv,.xlsx,.xls"
                        onChange={handleImportCattle}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                      <div className="border-2 border-dashed border-outline-variant rounded-2xl p-12 flex flex-col items-center justify-center gap-4 bg-surface-container-lowest hover:bg-surface-container-low hover:border-primary/50 transition-all group">
                        <div className="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center group-hover:scale-110 group-hover:bg-primary/10 transition-all">
                          <Sheet className="w-8 h-8 text-outline group-hover:text-primary transition-colors" />
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-on-surface">Clique ou arraste a planilha completa aqui</p>
                          <p className="text-sm text-outline font-medium">Formatos aceitos: .xlsx, .xls ou .csv</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-12 flex flex-col items-center justify-center gap-6">
                      <Loader2 className="w-12 h-12 text-primary animate-spin" />
                      <div className="text-center space-y-2">
                        <p className="text-xl font-bold text-on-surface">Processando animais...</p>
                        <p className="text-sm text-outline font-medium">Importando {importProgress.current} de {importProgress.total} registros</p>
                      </div>
                      <div className="w-full bg-surface-container-high h-3 rounded-full overflow-hidden max-w-md">
                        <motion.div 
                          className="h-full bg-primary"
                          initial={{ width: 0 }}
                          animate={{ width: `${(importProgress.current / (importProgress.total || 1)) * 100}%` }}
                        />
                      </div>
                    </div>
                  )
                ) : (
                  <div className="space-y-8 font-sans">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100 flex flex-col items-center">
                        <span className="text-3xl font-black text-emerald-700">{importResults.success}</span>
                        <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest mt-1 text-center">Registrados com Sucesso</span>
                      </div>
                      <div className="bg-red-50 p-6 rounded-2xl border border-red-100 flex flex-col items-center">
                        <span className="text-3xl font-black text-red-700">{importResults.error}</span>
                        <span className="text-xs font-bold text-red-600 uppercase tracking-widest mt-1 text-center">Negados / Avisos</span>
                      </div>
                    </div>

                    {importResults.details.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-bold text-on-surface uppercase tracking-wider text-outline">Relatório Detalhado</h4>
                        <div className="bg-surface-container-low rounded-2xl p-4 max-h-64 overflow-y-auto space-y-2 border border-outline-variant">
                          {importResults.details.map((detail, idx) => (
                            <p 
                              key={idx} 
                              className={cn(
                                "text-xs font-semibold leading-relaxed p-2.5 rounded-xl transition-all",
                                detail.includes("ignorado") || detail.includes("impedido") || detail.includes("duplicado") || detail.includes("existe")
                                  ? "text-amber-800 bg-amber-50 hover:bg-amber-100/70"
                                  : "text-on-surface hover:bg-surface-container-high"
                              )}
                            >
                              {detail}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant">
                      <button
                        type="button"
                        onClick={() => {
                          setImportResults(null)
                          setIsImporting(false)
                        }}
                        className="px-6 py-2.5 bg-primary text-white font-bold rounded-xl hover:brightness-110 transition-all text-sm cursor-pointer"
                      >
                        Visualizar Rebanho
                      </button>
                      <button
                        type="button"
                        onClick={() => setImportResults(null)}
                        className="px-6 py-2.5 bg-surface-container-high border border-outline-variant font-bold text-xs rounded-xl hover:brightness-95 transition-all text-on-surface cursor-pointer"
                      >
                        Importar Outro Arquivo
                      </button>
                    </div>
                  </div>
                )}
              </section>
                </details>
              </div>
            ) : (
              <form className="space-y-8" onSubmit={handleSave}>
              {/* Identification */}
              <section className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant shadow-sm">
                <div className="flex items-center gap-3 mb-8 border-b border-outline-variant pb-4">
                  <Fingerprint className="text-primary w-5 h-5" />
                  <h3 className="text-xl font-bold text-on-surface">Identificação</h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">IDV (ID Visual)</label>
                    <input 
                      id="tag_number"
                      value={formData.tag_number}
                      onChange={handleChange}
                      onBlur={() => checkDuplicate('tag_number', formData.tag_number)}
                      className={cn(
                        "w-full p-4 bg-surface-container-low border rounded-xl font-medium outline-none transition-all",
                        duplicates.tag_number ? "border-red-500 ring-4 ring-red-500/10" : "border-outline-variant focus:border-primary focus:ring-4 focus:ring-primary/5"
                      )}
                      placeholder="Ex: 1234-A" 
                    />
                    {duplicates.tag_number && <p className="text-[10px] text-red-600 font-bold uppercase tracking-wider">IDV duplicado na fazenda!</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">IDE (ID Eletrônico)</label>
                    <input 
                      id="electronic_id"
                      value={formData.electronic_id}
                      onChange={handleChange}
                      onBlur={() => checkDuplicate('electronic_id', formData.electronic_id)}
                      className={cn(
                        "w-full p-4 bg-surface-container-low border rounded-xl font-medium outline-none transition-all",
                        duplicates.electronic_id ? "border-red-500 ring-4 ring-red-500/10" : "border-outline-variant focus:border-primary focus:ring-4 focus:ring-primary/5"
                      )}
                      placeholder="RFID / Chip" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Data de Nascimento</label>
                    <input 
                      id="birth_date"
                      type="date"
                      value={formData.birth_date}
                      onChange={handleChange}
                      className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none focus:ring-4 focus:ring-primary/5 focus:border-primary transition-all" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Sexo</label>
                    <div className="flex bg-surface-container-high p-1.5 rounded-xl border border-outline-variant">
                      <button 
                        type="button"
                        onClick={() => {
                          setSex('Male')
                          setFormData(prev => ({ ...prev, category: 'Bezerro' }))
                        }}
                        className={cn(
                          "flex-1 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all",
                          sex === 'Male' ? "bg-primary text-white shadow-sm font-black" : "text-outline hover:text-on-surface"
                        )}
                      >
                        <Mars className="w-4 h-4" /> Macho
                      </button>
                      <button 
                        type="button"
                        onClick={() => {
                          setSex('Female')
                          setFormData(prev => ({ ...prev, category: 'Bezerra' }))
                        }}
                        className={cn(
                          "flex-1 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all",
                          sex === 'Female' ? "bg-primary text-white shadow-sm font-black" : "text-outline hover:text-on-surface"
                        )}
                      >
                        <Venus className="w-4 h-4" /> Fêmea
                      </button>
                    </div>
                  </div>
                  <div className="col-span-full md:col-span-1 space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Categoria</label>
                    <div className="relative">
                      <select 
                        id="category"
                        value={formData.category}
                        onChange={handleChange}
                        className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none appearance-none focus:ring-4 focus:ring-primary/5 focus:border-primary transition-all"
                      >
                        {categoryOptions[sex].map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-outline w-4 h-4 pointer-events-none" />
                    </div>
                  </div>
                  
                  {/* Pedigree Section in Identification */}
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline flex items-center gap-2">
                      Mãe (IDV/IDE) 
                      {searchingParent.mother && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
                      {parentMatch.mother && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                      {!searchingParent.mother && formData.mother_id && !parentMatch.mother && <AlertCircle className="w-3 h-3 text-amber-500" />}
                    </label>
                    <div className="relative">
                      <input 
                        id="mother_id"
                        value={formData.mother_id}
                        onChange={handleChange}
                        onBlur={() => lookupParent('mother', formData.mother_id)}
                        className={cn(
                          "w-full p-4 bg-surface-container-low border rounded-xl font-medium outline-none transition-all",
                          parentMatch.mother ? "border-green-200 bg-green-50/10" : "border-outline-variant focus:border-primary focus:ring-4 focus:ring-primary/5"
                        )}
                        placeholder="Brinco da mãe" 
                      />
                    </div>
                    {parentMatch.mother && <p className="text-[10px] text-green-600 font-bold uppercase tracking-wider">Identificada: {parentMatch.mother.breed || 'NELORE'}</p>}
                    {!searchingParent.mother && formData.mother_id && !parentMatch.mother && <p className="text-[10px] text-amber-600 font-bold uppercase tracking-wider">Mãe não encontrada no sistema</p>}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline flex items-center gap-2">
                      Pai (IDV/IDE)
                      {searchingParent.father && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
                      {parentMatch.father && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                      {!searchingParent.father && formData.father_id && !parentMatch.father && <AlertCircle className="w-3 h-3 text-amber-500" />}
                    </label>
                    <div className="relative">
                      <input 
                        id="father_id"
                        value={formData.father_id}
                        onChange={handleChange}
                        onBlur={() => lookupParent('father', formData.father_id)}
                        className={cn(
                          "w-full p-4 bg-surface-container-low border rounded-xl font-medium outline-none transition-all",
                          parentMatch.father ? "border-green-200 bg-green-50/10" : "border-outline-variant focus:border-primary focus:ring-4 focus:ring-primary/5"
                        )}
                        placeholder="Brinco do pai" 
                      />
                    </div>
                    {parentMatch.father && <p className="text-[10px] text-green-600 font-bold uppercase tracking-wider">Identificado: {parentMatch.father.breed || 'NELORE'}</p>}
                    {!searchingParent.father && formData.father_id && !parentMatch.father && <p className="text-[10px] text-amber-600 font-bold uppercase tracking-wider">Pai não encontrado no sistema</p>}
                  </div>
                </div>
              </section>

              {/* Specs */}
              <section className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Raça</label>
                    <input id="breed" value={formData.breed} onChange={handleChange} className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none focus:border-primary transition-all" placeholder="Ex: Nelore" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Peso (Kg)</label>
                    <input id="weight_kg" type="number" value={formData.weight_kg} onChange={handleChange} className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none focus:border-primary transition-all" placeholder="0.00" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Lote/Pasto</label>
                    <div className="relative">
                      <select id="pasture" value={formData.pasture} onChange={handleChange} className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none appearance-none focus:border-primary transition-all">
                        {pasturesList.length === 0 ? (
                          <option value="">Nenhum pasto cadastrado</option>
                        ) : (
                          <>
                            <option value="">Selecione um lote</option>
                            {pasturesList.map(p => (
                              <option key={p.id} value={p.name}>{p.name}</option>
                            ))}
                          </>
                        )}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-outline w-4 h-4 pointer-events-none" />
                    </div>
                  </div>
                </div>
              </section>

              <div className="pt-8 flex flex-col md:flex-row items-center justify-between border-t border-outline-variant mt-12 gap-6">
                <div className="flex items-center gap-3 text-outline">
                  <Info className="w-5 h-5 text-tertiary" />
                  <span className="text-sm italic font-medium">Os dados são salvos em tempo real no servidor seguro.</span>
                </div>
                <div className="flex gap-4 w-full md:w-auto">
                  <button type="button" onClick={() => setActiveTab('list')} className="flex-1 md:flex-none px-10 py-3 rounded-xl border border-outline-variant text-outline font-bold hover:bg-surface-container transition-all">Cancelar</button>
                  <button type="submit" disabled={loading} className="flex-1 md:flex-none px-10 py-3 rounded-xl bg-primary text-white font-bold hover:brightness-110 transition-all flex items-center justify-center gap-2">
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                    Confirmar Registro
                  </button>
                </div>
              </div>
            </form>
          )}
          </motion.div>
        )}

        {activeTab === 'pastures' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-4xl mx-auto pb-20"
          >
            <div className="flex justify-between items-center mb-10">
              <h2 className="text-4xl font-bold text-primary tracking-tight">Novo Lote/Pasto</h2>
              <button 
                onClick={handleSavePasture}
                disabled={loading}
                className="px-8 py-3 bg-primary text-white rounded-xl font-bold shadow-lg flex items-center gap-2 hover:brightness-110 disabled:opacity-70"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Salvar Lote/Pasto
              </button>
            </div>

            {/* Success/Error Alerts */}
            {pastureStatus === 'success' && (
              <div className="mb-8 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3 text-green-700">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <p className="font-semibold">Lote/Pasto registrado com sucesso!</p>
              </div>
            )}
            {pastureStatus === 'error' && (
              <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Ops! Algo deu errado</p>
                  <p className="text-sm font-medium">{pastureErrorMessage}</p>
                </div>
              </div>
            )}

            <form className="space-y-8" onSubmit={handleSavePasture}>
              <section className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant shadow-sm">
                <div className="flex items-center gap-3 mb-8 border-b border-outline-variant pb-4">
                  <Package className="text-primary w-5 h-5" />
                  <h3 className="text-xl font-bold text-on-surface">Informações do Lote</h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="col-span-full space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Nome do Lote/Pasto</label>
                    <input 
                      id="name"
                      value={pastureFormData.name}
                      onChange={handlePastureChange}
                      className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all"
                      placeholder="Ex: Lote 01 - Recria" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Área (Hectares)</label>
                    <input 
                      id="area_ha"
                      type="number"
                      step="0.01"
                      value={pastureFormData.area_ha}
                      onChange={handlePastureChange}
                      className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all"
                      placeholder="0.00" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Capacidade (Cabeças)</label>
                    <input 
                      id="capacity"
                      type="number"
                      value={pastureFormData.capacity}
                      onChange={handlePastureChange}
                      className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all"
                      placeholder="0" 
                    />
                  </div>
                  <div className="col-span-full space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Descrição / Observações</label>
                    <textarea 
                      id="description"
                      rows={4}
                      value={pastureFormData.description}
                      onChange={handlePastureChange}
                      className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all resize-none"
                      placeholder="Detalhes sobre o pasto, tipo de capim, etc." 
                    />
                  </div>
                </div>
              </section>

              <div className="pt-8 flex flex-col md:flex-row items-center justify-between border-t border-outline-variant mt-12 gap-6">
                <div className="flex items-center gap-3 text-outline">
                  <Info className="w-5 h-5 text-tertiary" />
                  <span className="text-sm italic font-medium">Os lotes cadastrados estarão disponíveis na ficha do animal.</span>
                </div>
                <div className="flex gap-4 w-full md:w-auto">
                  <button type="button" onClick={() => setActiveTab('list')} className="flex-1 md:flex-none px-10 py-3 rounded-xl border border-outline-variant text-outline font-bold hover:bg-surface-container transition-all">Cancelar</button>
                  <button type="submit" disabled={loading} className="flex-1 md:flex-none px-10 py-3 rounded-xl bg-primary text-white font-bold hover:brightness-110 transition-all flex items-center justify-center gap-2">
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                    Confirmar Cadastro
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        )}

        {activeTab === 'semen' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-4xl mx-auto pb-20"
          >
            <div className="flex justify-between items-center mb-10">
              <h2 className="text-4xl font-bold text-primary tracking-tight">Botijão de Sêmen</h2>
              <button 
                onClick={handleSaveSemen}
                disabled={loading}
                className="px-8 py-3 bg-primary text-white rounded-xl font-bold shadow-lg flex items-center gap-2 hover:brightness-110 disabled:opacity-70"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Registrar Touro
              </button>
            </div>

            {semenStatus === 'success' && (
              <div className="mb-8 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3 text-green-700">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <p className="font-semibold">Sêmen registrado com sucesso!</p>
              </div>
            )}
            {semenStatus === 'error' && (
              <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Ops! Algo deu errado</p>
                  <p className="text-sm font-medium">{semenErrorMessage}</p>
                </div>
              </div>
            )}

            <form className="space-y-8" onSubmit={handleSaveSemen}>
              <section className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant shadow-sm">
                <div className="flex items-center gap-3 mb-8 border-b border-outline-variant pb-4">
                  <Activity className="text-primary w-5 h-5" />
                  <h3 className="text-xl font-bold text-on-surface">Dados do Doador</h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Nome do Touro</label>
                    <input 
                      id="bull_name"
                      value={semenFormData.bull_name}
                      onChange={handleSemenChange}
                      className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none focus:border-primary transition-all"
                      placeholder="Ex: BACKUP" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Raça</label>
                    <select 
                      id="bull_breed"
                      value={semenFormData.bull_breed}
                      onChange={handleSemenChange}
                      className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none focus:border-primary transition-all"
                    >
                      <option>NELORE</option>
                      <option>ANGUS</option>
                      <option>BRAFORD</option>
                      <option>BRANGUS</option>
                      <option>SENEPOL</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Quantidade de Doses</label>
                    <input 
                      id="dose_count"
                      type="number"
                      value={semenFormData.dose_count}
                      onChange={handleSemenChange}
                      className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none focus:border-primary transition-all"
                      placeholder="0" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Fornecedor / Central</label>
                    <input 
                      id="provider"
                      value={semenFormData.provider}
                      onChange={handleSemenChange}
                      className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none focus:border-primary transition-all"
                      placeholder="Ex: ABS, CRV Lagoa" 
                    />
                  </div>
                  <div className="col-span-full space-y-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-outline">Observações</label>
                    <textarea 
                      id="notes"
                      rows={3}
                      value={semenFormData.notes}
                      onChange={handleSemenChange}
                      className="w-full p-4 bg-surface-container-low border border-outline-variant rounded-xl font-medium outline-none focus:border-primary transition-all resize-none"
                      placeholder="Linhagem, comentários, etc." 
                    />
                  </div>
                </div>
              </section>

              <div className="pt-8 flex justify-end gap-4 border-t border-outline-variant mt-12">
                <button type="button" onClick={() => setActiveTab('list')} className="px-10 py-3 rounded-xl border border-outline-variant text-outline font-bold hover:bg-surface-container transition-all">Cancelar</button>
                <button type="submit" disabled={loading} className="px-10 py-3 rounded-xl bg-primary text-white font-bold hover:brightness-110 transition-all flex items-center gap-2">
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                  Confirmar Cadastro
                </button>
              </div>
            </form>
          </motion.div>
        )}

        {activeTab === 'details' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-8 pb-20"
          >
            {!selectedAnimal ? (
              <div className="bg-surface-container-lowest p-20 border border-outline-variant rounded-2xl text-center">
                <Info className="w-12 h-12 text-outline mx-auto mb-4" />
                <h3 className="text-xl font-bold text-primary">Nenhum animal selecionado</h3>
                <p className="text-outline mt-2 max-w-sm mx-auto">Selecione um animal na listagem para ver sua ficha completa.</p>
                <button onClick={() => setActiveTab('list')} className="mt-8 px-6 py-2 text-primary font-bold hover:underline">Ir para listagem</button>
              </div>
            ) : (
              <>
                {/* Detail Header */}
                <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                      <Fingerprint className="w-8 h-8" />
                    </div>
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-3xl font-bold text-primary tracking-tight">{selectedAnimal.tag_number}</h2>
                        <span className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                          selectedAnimal.status === 'Active' ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                        )}>
                          {selectedAnimal.status === 'Active' ? 'Ativo' : 'Pendente'}
                        </span>
                      </div>
                      <p className="text-outline font-medium">IDE: {selectedAnimal.electronic_id || 'Não cadastrado'}</p>
                    </div>
                  </div>
                  <div className="flex gap-3 w-full md:w-auto">
                    <button 
                      onClick={() => setActiveTab('list')}
                      className="flex-1 md:flex-none px-6 py-3 border border-outline-variant rounded-xl font-bold text-outline hover:bg-surface-container transition-all"
                    >
                      Voltar
                    </button>
                    <button className="flex-1 md:flex-none px-6 py-3 bg-secondary text-white rounded-xl font-bold hover:brightness-110 shadow-lg shadow-secondary/10 transition-all flex items-center justify-center gap-2">
                      <Plus className="w-4 h-4" /> Registrar Manejo
                    </button>
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  {[
                    { label: 'Raça', value: selectedAnimal.breed || 'Nelore', icon: Info },
                    { label: 'Categoria', value: selectedAnimal.category || 'N/A', icon: Package },
                    { label: 'Peso Atual', value: selectedAnimal.weight_kg ? `${selectedAnimal.weight_kg} kg` : '0 kg', icon: History },
                  ].map((stat, i) => (
                    <div key={i} className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-outline mb-1">{stat.label}</p>
                      <div className="flex items-center gap-2">
                        <stat.icon className="w-4 h-4 text-primary opacity-50" />
                        <span className="text-xl font-bold text-on-surface">{stat.value}</span>
                      </div>
                    </div>
                  ))}

                  {/* Pasto Stat Card - EDITABLE */}
                  <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant flex flex-col justify-between relative group">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <p className="text-[10px] uppercase tracking-widest font-bold text-outline">Pasto</p>
                        {!isEditingPasture && (
                          <button 
                            type="button"
                            onClick={() => {
                              setSelectedPastureVal(selectedAnimal.pasture || '')
                              setIsEditingPasture(true)
                            }}
                            className="text-[10px] font-bold text-primary hover:underline flex items-center gap-0.5 cursor-pointer"
                          >
                            Editar
                          </button>
                        )}
                      </div>
                      
                      {isEditingPasture ? (
                        <div className="space-y-2 mt-1">
                          <div className="relative">
                            <select
                              value={selectedPastureVal}
                              onChange={(e) => setSelectedPastureVal(e.target.value)}
                              className="w-full text-xs p-2 bg-surface-container-low border border-outline-variant rounded-lg font-bold outline-none appearance-none focus:border-primary pr-8"
                              disabled={savingPasture}
                            >
                              <option value="">Nenhum pasto</option>
                              {pasturesList.map(p => (
                                <option key={p.id} value={p.name}>{p.name}</option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-outline w-3.5 h-3.5 pointer-events-none" />
                          </div>
                          <div className="flex gap-1.5 justify-end">
                            <button
                              type="button"
                              onClick={() => setIsEditingPasture(false)}
                              className="px-2 py-1 text-[10px] font-bold text-outline hover:bg-black/5 rounded"
                              disabled={savingPasture}
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={handleUpdatePasture}
                              className="px-2.5 py-1 text-[10px] font-bold bg-primary text-white hover:bg-primary-dark rounded flex items-center gap-1"
                              disabled={savingPasture}
                            >
                              {savingPasture ? 'Salvando...' : 'Salvar'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-1">
                          <Search className="w-4 h-4 text-primary opacity-50" />
                          <span className="text-xl font-bold text-on-surface truncate">
                            {selectedAnimal.pasture || 'Nenhum Pasto'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left Column: Data */}
                  <div className="lg:col-span-2 space-y-8">
                    <section className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant">
                      <h3 className="text-lg font-bold text-primary mb-6 flex items-center gap-2">
                        <Info className="w-5 h-5" /> Informações Básicas
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-12">
                        <div>
                          <p className="text-[10px] uppercase font-bold text-outline tracking-wider mb-1">Data de Nascimento</p>
                          <p className="font-bold text-on-surface">{(selectedAnimal as any).birth_date ? new Date((selectedAnimal as any).birth_date).toLocaleDateString('pt-BR') : 'Não informada'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase font-bold text-outline tracking-wider mb-1">Sexo</p>
                          <p className="font-bold text-on-surface flex items-center gap-2">
                            {(selectedAnimal as any).gender === 'Female' ? <><Venus className="w-4 h-4 text-pink-500" /> Fêmea</> : <><Mars className="w-4 h-4 text-blue-500" /> Macho</>}
                          </p>
                        </div>
                      </div>
                    </section>

                    {/* 🧬 Genealogia / Árvore Genealógica */}
                    <section className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant">
                      <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-bold text-primary flex items-center gap-2">
                          🧬 Genealogia / Árvore Genealógica
                        </h3>
                        {loadingGenealogy && (
                          <span className="text-xs text-outline flex items-center gap-1.5 bg-surface-container py-1 px-2.5 rounded-lg">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> Carregando links...
                          </span>
                        )}
                      </div>

                      <div className="space-y-6">
                        {/* Parent nodes: Mother & Father */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
                          {/* Mother Block */}
                          <div className="bg-pink-50/20 p-5 rounded-2xl border border-pink-100/60 flex flex-col justify-between hover:bg-pink-50/40 transition-all shadow-sm">
                            <div>
                              <span className="text-[10px] uppercase tracking-widest font-black text-pink-600 mb-1.5 block">Mãe</span>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-mono text-base font-black text-on-surface">
                                  {selectedAnimal.mother_id || 'Não Informada'}
                                </span>
                                {parentDetails.motherAnimal?.breed && (
                                  <span className="text-[10px] font-bold text-pink-700 bg-pink-100/50 px-2 py-0.5 rounded-md uppercase tracking-tight">
                                    {parentDetails.motherAnimal.breed}
                                  </span>
                                )}
                              </div>
                              {parentDetails.motherAnimal ? (
                                <p className="text-xs text-pink-800 font-bold">
                                  &ldquo;{parentDetails.motherAnimal.tag_number || parentDetails.motherAnimal.name || 'Nelore Linda'}&rdquo;
                                </p>
                              ) : (
                                selectedAnimal.mother_id && (
                                  <p className="text-[10px] text-amber-600 font-bold uppercase tracking-wider">
                                    ⚠️ Registro externo ou não cadastrado
                                  </p>
                                )
                              )}
                            </div>
                            {parentDetails.motherAnimal && (
                              <button
                                type="button"
                                onClick={() => setSelectedAnimal(parentDetails.motherAnimal)}
                                className="w-fit text-xs font-bold text-pink-700 hover:text-pink-900 flex items-center gap-2 bg-pink-100/70 hover:bg-pink-100 px-3.5 py-2 rounded-xl border border-pink-200/50 transition-all cursor-pointer mt-4"
                              >
                                <span>Ver Ficha</span>
                                <ArrowLeft className="w-3.5 h-3.5 rotate-180" />
                              </button>
                            )}
                          </div>

                          {/* Father Block */}
                          <div className="bg-blue-50/20 p-5 rounded-2xl border border-blue-100/60 flex flex-col justify-between hover:bg-blue-50/40 transition-all shadow-sm">
                            <div>
                              <span className="text-[10px] uppercase tracking-widest font-black text-blue-600 mb-1.5 block">Pai</span>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-mono text-base font-black text-on-surface">
                                  {selectedAnimal.father_id || 'Não Informado'}
                                </span>
                                {parentDetails.fatherAnimal?.breed && (
                                  <span className="text-[10px] font-bold text-blue-700 bg-blue-100/50 px-2 py-0.5 rounded-md uppercase tracking-tight">
                                    {parentDetails.fatherAnimal.breed}
                                  </span>
                                )}
                              </div>
                              {parentDetails.fatherAnimal ? (
                                <p className="text-xs text-blue-800 font-bold">
                                  &ldquo;{parentDetails.fatherAnimal.tag_number || parentDetails.fatherAnimal.name || 'Brangus Imperador'}&rdquo;
                                </p>
                              ) : (
                                selectedAnimal.father_id && (
                                  <p className="text-[10px] text-amber-600 font-bold uppercase tracking-wider">
                                    ⚠️ Registro externo ou não cadastrado
                                  </p>
                                )
                              )}
                            </div>
                            {parentDetails.fatherAnimal && (
                              <button
                                type="button"
                                onClick={() => setSelectedAnimal(parentDetails.fatherAnimal)}
                                className="w-fit text-xs font-bold text-blue-700 hover:text-blue-900 flex items-center gap-2 bg-blue-100/70 hover:bg-blue-100 px-3.5 py-2 rounded-xl border border-blue-200/50 transition-all cursor-pointer mt-4"
                              >
                                <span>Ver Ficha</span>
                                <ArrowLeft className="w-3.5 h-3.5 rotate-180" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Grandparents Row - Expanded Materna line */}
                        {selectedAnimal.mother_id && (parentDetails.motherAnimal?.father_id || parentDetails.motherAnimal?.mother_id || parentDetails.grandFatherMaterno || parentDetails.grandMotherMaterna) ? (
                          <div className="pt-6 border-t border-dashed border-outline-variant space-y-4">
                            <h4 className="text-[10px] font-black uppercase text-outline tracking-wider flex items-center gap-2 mb-2">
                              <span>Linha Materna (Avos)</span>
                              <span className="font-normal text-outline-variant text-[9px] lowercase">(auto extraído)</span>
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {/* Avô Materno */}
                              {parentDetails.motherAnimal?.father_id && (
                                <div className="bg-surface-container-low p-4.5 rounded-xl border border-outline-variant flex justify-between items-center transition-all hover:bg-surface-container-high">
                                  <div className="space-y-1">
                                    <span className="text-[9px] uppercase font-black text-outline block">Avô Materno</span>
                                    <span className="font-mono text-sm font-bold text-on-surface block text-primary">
                                      → {parentDetails.motherAnimal.father_id}
                                    </span>
                                    {parentDetails.grandFatherMaterno?.breed && (
                                      <span className="text-[10px] font-bold text-primary block">
                                        {parentDetails.grandFatherMaterno.breed} (&ldquo;{parentDetails.grandFatherMaterno.name}&rdquo;)
                                      </span>
                                    )}
                                  </div>
                                  {parentDetails.grandFatherMaterno && (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedAnimal(parentDetails.grandFatherMaterno)}
                                      className="text-xs font-bold text-primary hover:text-primary-dark hover:underline flex items-center gap-1 cursor-pointer bg-white border border-outline-variant py-1 px-2.5 rounded-lg shadow-sm"
                                    >
                                      Ficha
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Avó Materna */}
                              {parentDetails.motherAnimal?.mother_id && (
                                <div className="bg-surface-container-low p-4.5 rounded-xl border border-outline-variant flex justify-between items-center transition-all hover:bg-surface-container-high">
                                  <div className="space-y-1">
                                    <span className="text-[9px] uppercase font-black text-outline block">Avó Materna</span>
                                    <span className="font-mono text-sm font-bold text-on-surface block text-pink-700">
                                      → {parentDetails.motherAnimal.mother_id}
                                    </span>
                                    {parentDetails.grandMotherMaterna?.breed && (
                                      <span className="text-[10px] font-bold text-pink-700 block">
                                        {parentDetails.grandMotherMaterna.breed} (&ldquo;{parentDetails.grandMotherMaterna.name}&rdquo;)
                                      </span>
                                    )}
                                  </div>
                                  {parentDetails.grandMotherMaterna && (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedAnimal(parentDetails.grandMotherMaterna)}
                                      className="text-xs font-bold text-primary hover:text-primary-dark hover:underline flex items-center gap-1 cursor-pointer bg-white border border-outline-variant py-1 px-2.5 rounded-lg shadow-sm"
                                    >
                                      Ficha
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </section>

                    <section className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant">
                      <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-bold text-primary flex items-center gap-2">
                          <History className="w-5 h-5" /> Histórico de Pesagem
                        </h3>
                        {weightHistory.length > 1 && (
                          <div className="flex items-center gap-2 px-3 py-1 bg-green-50 rounded-lg border border-green-100">
                             <TrendingUp className="w-3 h-3 text-green-600" />
                             <span className="text-[10px] font-bold text-green-700 uppercase tracking-widest">
                               GMD: {(() => {
                                 const newest = weightHistory[0];
                                 const oldest = weightHistory[weightHistory.length - 1];
                                 const weightDiff = newest.weight_kg - oldest.weight_kg;
                                 const daysDiff = (new Date(newest.inserted_at).getTime() - new Date(oldest.inserted_at).getTime()) / (1000 * 3600 * 24);
                                 return daysDiff > 0 ? (weightDiff / daysDiff).toFixed(2) : "0.00";
                               })()} kg/dia
                             </span>
                          </div>
                        )}
                      </div>
                      
                      {loadingHistory ? (
                        <div className="py-12 flex justify-center">
                          <Loader2 className="w-8 h-8 animate-spin text-primary opacity-20" />
                        </div>
                      ) : weightHistory.length === 0 ? (
                        <div className="text-center py-12 border-2 border-dashed border-outline-variant rounded-xl">
                          <p className="text-outline text-sm font-medium">Nenhum histórico de pesagem disponível.</p>
                          <button 
                            onClick={() => router.push('/dashboard/corral')}
                            className="mt-4 px-6 py-2 bg-surface-container-high rounded-lg text-xs font-bold text-primary hover:bg-surface-container-highest transition-all"
                          >
                            Ir para o Curral Registrar
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="grid grid-cols-3 px-4 py-2 text-[10px] uppercase tracking-widest font-black text-outline">
                            <span>Data</span>
                            <span className="text-center">Peso</span>
                            <span className="text-right">Evolução</span>
                          </div>
                          {weightHistory.map((w, i) => {
                            const prev = weightHistory[i + 1]
                            const diff = prev ? w.weight_kg - prev.weight_kg : 0
                            return (
                              <div key={w.id} className="grid grid-cols-3 px-4 py-4 bg-surface-container-low rounded-xl border border-outline-variant items-center">
                                <div className="text-sm font-bold text-on-surface">
                                  {new Date(w.inserted_at).toLocaleDateString('pt-BR')}
                                </div>
                                <div className="text-center font-mono font-black text-primary">
                                  {w.weight_kg.toFixed(1)} kg
                                </div>
                                <div className="text-right">
                                  {prev ? (
                                    <span className={cn(
                                      "text-[10px] font-black px-2 py-0.5 rounded-md",
                                      diff >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                                    )}>
                                      {diff >= 0 ? '+' : ''}{diff.toFixed(1)} kg
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-bold text-outline uppercase tracking-widest">Base</span>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </section>
                  </div>

                  {/* Right Column: Timeline/Actions */}
                  <div className="space-y-8">
                    {/* INJECTED SMART REPRO */}
                    {selectedAnimal.gender === 'Female' && (() => {
                      const isCurrentlyPregnant = lastReproEvent && 
                        (lastReproEvent.event_type === 'diagnosis' && lastReproEvent.status === 'pregnant');

                      const latestCalf = offspringList && offspringList.length > 0 ? offspringList[0] : null;
                      const calvedAfterPregnancy = isCurrentlyPregnant && latestCalf && lastReproEvent &&
                        (new Date(latestCalf.birth_date || '').getTime() > new Date(lastReproEvent.inserted_at).getTime());

                      const isPrenha = isCurrentlyPregnant && !calvedAfterPregnancy;
                      const activeCalf = offspringList?.find(calf => !weaningEventsList.some(w => w.cattle_id === calf.id));

                      let repStatusLabel = 'Vazia / Disponível';
                      let repStatusColor = 'bg-surface-container text-outline border-outline-variant';

                      if (isPrenha) {
                        repStatusLabel = 'Prenha';
                        repStatusColor = 'bg-green-500/10 text-green-700 border-green-500/20';
                      } else if (activeCalf) {
                        repStatusLabel = 'Parida';
                        repStatusColor = 'bg-pink-500/10 text-pink-700 border-pink-500/20';
                      } else if (latestCalf && latestCalf.birth_date) {
                        const daysSince = Math.floor((new Date().getTime() - new Date(latestCalf.birth_date).getTime()) / (1000 * 3600 * 24));
                        if (daysSince < 30) {
                          repStatusLabel = `Pós-parto / Recuperação (${daysSince}D)`;
                          repStatusColor = 'bg-amber-500/10 text-amber-700 border-amber-500/20';
                        } else {
                          repStatusLabel = 'Disponível / Pós-parto';
                          repStatusColor = 'bg-blue-500/10 text-blue-700 border-blue-500/20';
                        }
                      }

                      const lastCalvingDateStr = latestCalf?.birth_date
                        ? (() => {
                            const parts = latestCalf.birth_date.split('-')
                            return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : new Date(latestCalf.birth_date).toLocaleDateString('pt-BR')
                          })()
                        : null;

                      return (
                        <div className="space-y-8">
                          {/* Main Status & Quick Info */}
                          <section className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant">
                            <div className="flex justify-between items-center mb-6 border-b border-outline-variant pb-4">
                              <h3 className="text-lg font-bold text-primary flex items-center gap-2">
                                🧬 Status Reprodutivo Inteligente
                              </h3>
                              {loadingOffspring && (
                                <span className="text-xs text-outline flex items-center gap-1.5 bg-surface-container py-1 px-2.5 rounded-lg">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> Carregando...
                                </span>
                              )}
                            </div>

                            <div className="space-y-6">
                              {reproToast && (
                                <div className={cn(
                                  "p-4 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 shadow-sm",
                                  reproToast.type === 'success' 
                                    ? 'bg-green-500/10 text-green-700 border-green-500/20' 
                                    : 'bg-red-500/10 text-red-700 border-red-500/10'
                                )}>
                                  <div className="flex items-center gap-2">
                                    <span>{reproToast.type === 'success' ? '✅' : '❌'}</span>
                                    <span>{reproToast.message}</span>
                                  </div>
                                  <button 
                                    type="button" 
                                    onClick={() => setReproToast(null)} 
                                    className="hover:opacity-70 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-black/5"
                                  >
                                    Fechar
                                  </button>
                                </div>
                              )}

                              {/* Status Badge Custom */}
                              <div className={cn("p-5 rounded-2xl border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 transition-all shadow-sm", repStatusColor)}>
                                <div className="space-y-1">
                                  <span className="text-[10px] uppercase tracking-widest font-black opacity-60">Status Reprodutivo Atual</span>
                                  <p className="text-xl font-extrabold">{repStatusLabel}</p>
                                </div>
                                {isPrenha && lastReproEvent && (
                                  <div className="text-right">
                                    <span className="text-[10px] block opacity-60 uppercase font-bold">Diagnóstico em</span>
                                    <span className="font-mono text-sm font-bold">
                                      {new Date(lastReproEvent.inserted_at).toLocaleDateString('pt-BR')}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Calf at foot (Bezerro ao Pé) block */}
                              {activeCalf ? (() => {
                                const birthDateObj = new Date(activeCalf.birth_date || '');
                                const daysDiff = Math.floor((new Date().getTime() - birthDateObj.getTime()) / (1000 * 3600 * 24));
                                const expectedWeanDate = new Date(birthDateObj.getTime() + 210 * 24 * 60 * 60 * 1000);
                                const expectedWeanStr = expectedWeanDate.toLocaleDateString('pt-BR');

                                return (
                                  <div className="p-6 bg-pink-50/10 border border-pink-200/50 rounded-2xl space-y-4 hover:bg-pink-50/20 transition-all">
                                    <div className="flex justify-between items-center">
                                      <div>
                                        <span className="text-[10px] uppercase tracking-widest font-black text-pink-600 block">Bezerro ao Pé</span>
                                        <h4 className="text-base font-black text-on-surface font-mono">Brinco: {activeCalf.tag_number}</h4>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => setSelectedAnimal(activeCalf)}
                                        className="text-xs font-bold text-pink-700 hover:text-pink-900 bg-pink-100/40 hover:bg-pink-100 px-3 py-1.5 rounded-xl border border-pink-200/30 transition-all flex items-center gap-1.5"
                                      >
                                        Ver Ficha <ArrowLeft className="w-3.5 h-3.5 rotate-180" />
                                      </button>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 text-xs font-medium border-t border-b border-pink-100/30 py-4">
                                      <div>
                                        <p className="text-outline uppercase text-[10px] tracking-wide font-bold">Última Parição</p>
                                        <p className="text-on-surface font-black mt-0.5">{lastCalvingDateStr || 'Não Informado'}</p>
                                      </div>
                                      <div>
                                        <p className="text-outline uppercase text-[10px] tracking-wide font-bold">Dias Pós-Parto</p>
                                        <p className="text-on-surface font-black mt-0.5">{daysDiff} dias</p>
                                      </div>
                                      <div className="col-span-2">
                                        <p className="text-outline uppercase text-[10px] tracking-wide font-bold">Previsão Desmame (7 meses)</p>
                                        <p className="text-pink-800 font-extrabold mt-0.5">{expectedWeanStr} <span className="text-[10px] opacity-75 font-normal">(sugerido aos 6~8 meses)</span></p>
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => handleRegisterWeaning(activeCalf.id)}
                                      className="w-full py-3 bg-pink-600 hover:bg-pink-700 text-white font-extrabold rounded-xl transition-all shadow-md active:scale-[0.99] flex items-center justify-center gap-2 text-xs uppercase tracking-wider"
                                    >
                                      🥛 Marcar Bezerro como Desmamado
                                    </button>
                                  </div>
                                );
                              })() : (
                                <div className="p-4 bg-surface-container-low rounded-xl border border-dashed border-outline-variant text-center">
                                  <p className="text-[10px] font-bold text-outline uppercase tracking-widest">Sem bezerro ao pé ativo</p>
                                  <p className="text-xs font-medium text-outline-variant mt-1 italic">Todos os bezerros anteriores foram desmamados ou não há partos</p>
                                </div>
                              )}
                            </div>
                          </section>

                          {/* Historical Calvings (Histórico de Parições) */}
                          <section className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant shadow-sm text-on-surface">
                            <h3 className="text-lg font-bold text-primary mb-6 flex items-center gap-2">
                              📋 Histórico de Parições
                            </h3>

                            {offspringList.length === 0 ? (
                              <div className="p-6 bg-surface-container-low rounded-xl border border-dashed border-outline-variant text-center text-outline text-xs">
                                Nenhuma parição registrada para esta vaca.
                              </div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                  <thead>
                                    <tr className="border-b border-outline-variant text-[10px] font-black uppercase tracking-wider text-outline">
                                      <th className="pb-3 pr-2">Brinco Filha(o)</th>
                                      <th className="pb-3 px-2">Data Parto</th>
                                      <th className="pb-3 px-2">Sexo</th>
                                      <th className="pb-3 pl-2 text-right">Desmame</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-outline-variant/50 text-xs text-on-surface">
                                    {offspringList.map((calf) => {
                                      const weaningEv = weaningEventsList.find(w => w.cattle_id === calf.id);
                                      const calfDateStr = calf.birth_date
                                        ? (() => {
                                            const parts = calf.birth_date.split('-')
                                            return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : new Date(calf.birth_date).toLocaleDateString('pt-BR')
                                          })()
                                        : 'N/A';

                                      return (
                                        <tr key={calf.id} className="hover:bg-surface-container-low/30 transition-colors">
                                          <td className="py-3 pr-2 font-mono font-bold text-primary">
                                            <button
                                              type="button"
                                              onClick={() => setSelectedAnimal(calf)}
                                              className="underline hover:text-primary-dark"
                                            >
                                              {calf.tag_number}
                                            </button>
                                          </td>
                                          <td className="py-3 px-2">{calfDateStr}</td>
                                          <td className="py-3 px-2 font-bold text-on-surface/70">
                                            {calf.gender === 'Female' ? 'Fêmea ♀' : 'Macho ♂'}
                                          </td>
                                          <td className="py-3 pl-2 text-right">
                                            {weaningEv ? (
                                              <span className="inline-block px-2.5 py-1 bg-green-500/10 text-green-700 text-[10px] font-black uppercase rounded-lg">
                                                Desmamado ({new Date(weaningEv.inserted_at).toLocaleDateString('pt-BR')})
                                              </span>
                                            ) : (
                                              <span className="inline-block px-2.5 py-1 bg-pink-500/10 text-pink-700 text-[10px] font-black uppercase rounded-lg">
                                                Ao Pé
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </section>
                        </div>
                      );
                    })()}
                    {false && (
                       <section className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant">
                         <h3 className="text-lg font-bold text-primary mb-6 flex items-center gap-2">
                           <Activity className="w-5 h-5" /> Status Reprodutivo
                         </h3>
                         
                         {loadingRepro ? (
                           <div className="py-6 flex justify-center">
                             <Loader2 className="w-6 h-6 animate-spin text-primary opacity-20" />
                           </div>
                         ) : !lastReproEvent ? (
                           <div className="p-4 bg-surface-container-low rounded-xl border border-dashed border-outline-variant text-center">
                             <p className="text-[10px] font-bold text-outline uppercase tracking-widest">Sem eventos registrados</p>
                             <p className="text-xs font-medium text-outline-variant mt-1 italic">Animal apto ou em recria</p>
                           </div>
                         ) : (
                           <div className="space-y-4">
                             <div className={cn(
                               "p-4 rounded-xl border flex flex-col gap-2",
                               lastReproEvent.status === 'pregnant' ? "bg-green-50 border-green-100" : 
                               lastReproEvent.status === 'empty' ? "bg-red-50 border-red-100" : "bg-primary-container/20 border-primary/10"
                             )}>
                               <div className="flex justify-between items-start">
                                 <span className={cn(
                                   "px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest",
                                   lastReproEvent.status === 'pregnant' ? "bg-green-600 text-white" : 
                                   lastReproEvent.status === 'empty' ? "bg-red-600 text-white" : "bg-primary text-white"
                                 )}>
                                   {lastReproEvent.status === 'pregnant' ? 'Prenha' : 
                                    lastReproEvent.status === 'empty' ? 'Vazia' : 
                                    lastReproEvent.status === 'retoque' ? 'Retoque' : 
                                    lastReproEvent.event_type.toUpperCase()}
                                 </span>
                                 <span className="text-[10px] font-bold text-outline-variant">
                                   {new Date(lastReproEvent.inserted_at).toLocaleDateString('pt-BR')}
                                 </span>
                               </div>
                               <div>
                                 <p className="text-xs font-bold text-on-surface">Último Evento: {
                                   lastReproEvent.event_type === 'insemination' ? 'Inseminação IA' :
                                   lastReproEvent.event_type === 'mating' ? 'Monta Natural' :
                                   lastReproEvent.event_type === 'diagnosis' ? 'Diagnóstico' : 'Parto'
                                 }</p>
                                 {(lastReproEvent.semen_bull || lastReproEvent.male_bull_tag) && (
                                   <p className="text-[10px] font-medium text-outline mt-1">
                                     Touro: {lastReproEvent.semen_bull || lastReproEvent.male_bull_tag}
                                   </p>
                                 )}
                               </div>
                             </div>
                             
                             {lastReproEvent.event_type !== 'diagnosis' && lastReproEvent.event_type !== 'birth' && (
                               <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg">
                                 <AlertCircle className="w-3 h-3 text-amber-600" />
                                 <p className="text-[10px] font-bold text-amber-800 uppercase tracking-tight">Aguardando Diagnóstico</p>
                               </div>
                             )}
                           </div>
                         )}
                       </section>
                    )}

                    <section className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant">
                      <h3 className="text-lg font-bold text-primary mb-6 flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5" /> Status Sanitário
                      </h3>
                      
                      {loadingHealth ? (
                        <div className="py-6 flex justify-center">
                          <Loader2 className="w-6 h-6 animate-spin text-primary opacity-20" />
                        </div>
                      ) : healthHistory.length === 0 ? (
                        <div className="p-4 bg-surface-container-low rounded-xl border border-dashed border-outline-variant text-center">
                           <p className="text-[10px] font-bold text-outline uppercase tracking-widest">Sem registros sanitários</p>
                           <p className="text-xs font-medium text-outline-variant mt-1 italic">Nenhum manejo recente realizado</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {healthHistory.map((record) => (
                            <div key={record.id} className="bg-surface-container-low p-4 rounded-xl border border-outline-variant flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  "w-8 h-8 rounded-lg flex items-center justify-center",
                                  record.record_type === 'vacina' ? "bg-green-100 text-green-700" :
                                  record.record_type === 'vermifugo' ? "bg-blue-100 text-blue-700" :
                                  "bg-amber-100 text-amber-700"
                                )}>
                                  {record.record_type === 'vacina' ? <CheckCircle2 className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                                </div>
                                <div>
                                  <p className="text-xs font-bold text-on-surface uppercase tracking-tight">
                                    {record.medication || record.record_type}
                                  </p>
                                  <p className="text-[10px] text-outline font-medium capitalize">
                                    {record.record_type}
                                  </p>
                                </div>
                              </div>
                              <span className="text-[9px] font-bold text-outline-variant bg-white px-2 py-0.5 rounded border border-outline-variant uppercase">
                                {new Date(record.inserted_at).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}
                              </span>
                            </div>
                          ))}
                          
                          <button 
                            onClick={() => router.push('/dashboard/corral')}
                            className="w-full py-3 text-[10px] font-black text-primary uppercase tracking-widest border-t border-outline-variant hover:bg-primary/5 transition-all mt-2"
                          >
                            Ir para curral
                          </button>
                        </div>
                      )}
                    </section>

                    <section className="bg-surface-container-lowest p-8 rounded-2xl border border-outline-variant">
                      <h3 className="text-lg font-bold text-primary mb-6 flex items-center gap-2">
                        <History className="w-5 h-5" /> Movimentações
                      </h3>
                      <div className="space-y-6 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-outline-variant">
                        {[
                          { title: 'Transferência de Pasto', date: 'Há 2 dias', desc: 'Pasto B -> Pasto Sul' },
                          { title: 'Entrada na Fazenda', date: '14/05/2026', desc: 'Registro inicial' },
                        ].map((event, i) => (
                          <div key={i} className="relative pl-10">
                            <div className="absolute left-1.5 top-1.5 w-3 h-3 bg-primary rounded-full border-2 border-white"></div>
                            <p className="text-xs font-bold text-on-surface">{event.title}</p>
                            <p className="text-[10px] text-outline mb-1">{event.date}</p>
                            <p className="text-[10px] font-medium p-2 bg-surface-container rounded-lg text-outline-variant">{event.desc}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}
      </div>
    </DashboardLayout>
  )
}

