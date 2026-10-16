import React, { useState, useEffect } from 'react';
import { User, Announcement, SellerApplication, UserShop } from '../types.ts';
import { ref, onValue, update, set, push, remove, get } from 'firebase/database';
import { db } from '../firebase.ts';

interface AdminPanelProps {
  users: User[];
  announcements: Announcement[];
  onAddAnnouncement: (text: string) => void;
  onUpdateAnnouncement: (id: string, text: string) => void;
  onDeleteAnnouncement: (id: string) => void;
  onSetRole: (userId: string, role: string, color?: string) => void;
  onBanUser: (userId: string) => void;
  onUserClick: (uid: string) => void;
  onToggleAdmin?: (userId: string, currentStatus: boolean) => void;
}

const PRESET_COLORS = [
  '#000000', '#EF4444', '#10B981', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#6B7280', '#06B6D4', '#00000000'
];

export const AdminPanel: React.FC<AdminPanelProps> = ({ 
  users, announcements, onAddAnnouncement, onUpdateAnnouncement, onDeleteAnnouncement, onSetRole, onBanUser, onUserClick, onToggleAdmin
}) => {
  const [activeTab, setActiveTab] = useState<'kyc' | 'users' | 'broadcast'>('kyc');
  const [adminSearch, setAdminSearch] = useState('');
  const [editingRoleUser, setEditingRoleUser] = useState<User | null>(null);
  const [newRoleValue, setNewRoleValue] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#000000');
  
  const [broadcastText, setBroadcastText] = useState('');
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);

  // Seller Applications state from Firebase RTDB
  const [sellerApplications, setSellerApplications] = useState<SellerApplication[]>([]);
  const [kycFilter, setKycFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [kycSearch, setKycSearch] = useState('');

  // Rejection reason modal
  const [rejectingApp, setRejectingApp] = useState<SellerApplication | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');

  // Fullscreen document viewer modal (for KTP & Selfie)
  const [fullscreenDoc, setFullscreenDoc] = useState<{ url: string; title: string; applicantName: string } | null>(null);

  // Toast banner
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Subscribe to sellerApplications in Firebase with fast direct pre-fetch
  useEffect(() => {
    const appsRef = ref(db, 'sellerApplications');

    // Fast direct get() to paint applications instantly
    get(appsRef).then((snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list: SellerApplication[] = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val
        })).sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
        setSellerApplications(list);
      }
    }).catch(() => {});

    const unsub = onValue(appsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list: SellerApplication[] = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val
        })).sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
        setSellerApplications(list);
      } else {
        setSellerApplications([]);
      }
    });

    return () => unsub();
  }, []);

  const pendingCount = sellerApplications.filter(a => a.status === 'pending').length;

  const filteredUsers = users.filter(u => {
    const safeSearch = (adminSearch || '').toLowerCase();
    return (u.name || '').toLowerCase().includes(safeSearch) || (u.email || '').toLowerCase().includes(safeSearch);
  });

  const filteredKycApps = sellerApplications.filter(app => {
    if (kycFilter !== 'all' && app.status !== kycFilter) return false;
    if (!kycSearch.trim()) return true;
    const q = kycSearch.toLowerCase();
    return (
      (app.fullName || '').toLowerCase().includes(q) ||
      (app.userName || '').toLowerCase().includes(q) ||
      (app.userEmail || '').toLowerCase().includes(q) ||
      (app.phoneWhatsapp || '').toLowerCase().includes(q) ||
      (app.shopName || '').toLowerCase().includes(q) ||
      (app.city || '').toLowerCase().includes(q) ||
      (app.province || '').toLowerCase().includes(q)
    );
  });

  // Approve seller application
  const handleApproveSeller = async (app: SellerApplication) => {
    try {
      const now = Date.now();
      // 1. Update application status
      await update(ref(db, `sellerApplications/${app.userId}`), {
        status: 'approved',
        reviewedAt: now,
        reviewedBy: 'Admin King'
      });

      // 2. Update user record
      await update(ref(db, `users/${app.userId}`), {
        isVerifiedSeller: true,
        sellerStatus: 'approved',
        role: 'Verified Merchant',
        roleColor: '#F59E0B'
      });

      // 3. Create or update UserShop in shops
      const shopId = `shop_${app.userId}`;
      const shopPayload: UserShop = {
        id: shopId,
        ownerId: app.userId,
        ownerName: app.userName || app.fullName,
        ownerPhoto: app.userPhoto || '',
        shopName: app.shopName,
        description: app.shopDescription || 'Toko Resmi Terverifikasi di Vimos',
        bannerURL: app.shopBannerURL || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&auto=format&fit=crop&q=80',
        phoneWhatsapp: app.phoneWhatsapp,
        location: `${app.city || ''}, ${app.province || ''}`.trim(),
        isVerified: true,
        createdAt: now
      };
      await set(ref(db, `shops/${shopId}`), shopPayload);

      // 4. Send notification to applicant
      const notifRef = push(ref(db, `notifications/${app.userId}`));
      await set(notifRef, {
        id: notifRef.key,
        senderId: 'admin_system',
        senderName: 'Vimos Admin Team',
        senderPhoto: 'https://api.dicebear.com/7.x/bottts/svg?seed=vimos_admin',
        type: 'comment',
        commentText: `🎉 Selamat! Pengajuan Akun Toko "${app.shopName}" Anda telah DISETUJUI oleh Admin. Anda sekarang dapat mulai menjual produk di etalase toko!`,
        timestamp: now,
        read: false
      });

      showToast(`Pengajuan toko "${app.shopName}" (${app.fullName}) berhasil disetujui! ✅`, 'success');
    } catch (err) {
      console.error('Error approving seller:', err);
      showToast('Gagal menyetujui pengajuan toko.', 'error');
    }
  };

  // Reject seller application
  const handleRejectSeller = async () => {
    if (!rejectingApp) return;
    const app = rejectingApp;
    const reason = rejectionReasonInput.trim() || 'Foto dokumen KTP kurang jelas atau data tidak sesuai.';

    try {
      const now = Date.now();
      // 1. Update application status
      await update(ref(db, `sellerApplications/${app.userId}`), {
        status: 'rejected',
        rejectionReason: reason,
        reviewedAt: now,
        reviewedBy: 'Admin King'
      });

      // 2. Update user record
      await update(ref(db, `users/${app.userId}`), {
        isVerifiedSeller: false,
        sellerStatus: 'rejected'
      });

      // 3. Send notification to applicant with explanation
      const notifRef = push(ref(db, `notifications/${app.userId}`));
      await set(notifRef, {
        id: notifRef.key,
        senderId: 'admin_system',
        senderName: 'Vimos Admin Team',
        senderPhoto: 'https://api.dicebear.com/7.x/bottts/svg?seed=vimos_admin',
        type: 'comment',
        commentText: `⚠️ Pengajuan Akun Toko "${app.shopName}" belum dapat disetujui. Alasan: ${reason}. Silakan perbaiki data dan ajukan ulang.`,
        timestamp: now,
        read: false
      });

      showToast(`Pengajuan toko ${app.fullName} ditolak dengan catatan.`, 'success');
      setRejectingApp(null);
      setRejectionReasonInput('');
    } catch (err) {
      console.error('Error rejecting seller:', err);
      showToast('Gagal menolak pengajuan toko.', 'error');
    }
  };

  // Permanently Delete Shop & Products & Revoke Seller Status (Admin)
  const handleDeleteShopAndRevokeByAdmin = async (app: SellerApplication) => {
    if (!window.confirm(`Hapus Toko "${app.shopName}" milik ${app.fullName} beserta seluruh produknya secara permanen?`)) return;

    try {
      // 1. Delete seller application
      await remove(ref(db, `sellerApplications/${app.userId}`));

      // 2. Find and delete shop
      const shopSnap = await get(ref(db, 'shops'));
      if (shopSnap.exists()) {
        const shopsVal = shopSnap.val();
        Object.entries(shopsVal).forEach(async ([shopId, shopData]: [string, any]) => {
          if (shopData.ownerId === app.userId) {
            await remove(ref(db, `shops/${shopId}`));
          }
        });
      }

      // 3. Find and delete shop items
      const itemsSnap = await get(ref(db, 'shopItems'));
      if (itemsSnap.exists()) {
        const itemsVal = itemsSnap.val();
        Object.entries(itemsVal).forEach(async ([itemId, itemData]: [string, any]) => {
          if (itemData.ownerId === app.userId) {
            await remove(ref(db, `shopItems/${itemId}`));
          }
        });
      }

      // 4. Update user record
      await update(ref(db, `users/${app.userId}`), {
        isVerifiedSeller: false,
        sellerStatus: 'unsubmitted',
        sellerApplicationId: null
      });

      // 5. Send notification to applicant
      const notifRef = push(ref(db, `notifications/${app.userId}`));
      await set(notifRef, {
        id: notifRef.key,
        senderId: 'admin_system',
        senderName: 'Vimos Admin Team',
        senderPhoto: 'https://api.dicebear.com/7.x/bottts/svg?seed=vimos_admin',
        type: 'comment',
        commentText: `⚠️ Toko Anda "${app.shopName}" beserta seluruh produknya telah dihapus oleh Admin Vimos. Status pedagang Anda telah dicabut.`,
        timestamp: Date.now(),
        read: false
      });

      showToast(`Toko "${app.shopName}" dan seluruh produknya berhasil dihapus.`, 'success');
    } catch (err) {
      console.error('Error deleting shop by admin:', err);
      showToast('Gagal menghapus toko.', 'error');
    }
  };

  const handleBroadcastSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastText.trim()) return;
    if (editingAnnId) {
      onUpdateAnnouncement(editingAnnId, broadcastText);
      setEditingAnnId(null);
    } else {
      onAddAnnouncement(broadcastText);
    }
    setBroadcastText('');
  };

  const startEditAnn = (ann: Announcement) => {
    setEditingAnnId(ann.id);
    setBroadcastText(ann.text);
  };

  return (
    <div className="p-4 sm:p-6 pb-28 animate-fade-in relative max-w-5xl mx-auto text-neutral-900">
      {/* Toast Alert */}
      {toastMsg && (
        <div className={`fixed top-16 left-1/2 -translate-x-1/2 z-[150] px-5 py-3 rounded-2xl shadow-2xl border flex items-center space-x-2 text-xs font-black transition-all animate-scale-up backdrop-blur-md ${
          toastMsg.type === 'success' ? 'bg-neutral-950 text-white border-amber-400' : 'bg-red-600 text-white border-red-700'
        }`}>
          <i className={`fas ${toastMsg.type === 'success' ? 'fa-circle-check text-amber-400' : 'fa-circle-exclamation'}`}></i>
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* HEADER COMMAND CENTER */}
      <div className="mb-6 bg-gradient-to-br from-neutral-950 via-zinc-900 to-black text-white p-5 sm:p-6 rounded-3xl shadow-xl border border-white/10 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="bg-amber-400 text-black text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full tracking-wider">
                👑 Super Admin
              </span>
              <span className="text-[10px] text-neutral-300 font-bold">Vimos Command Hub</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tight mt-1">Command Center</h2>
            <p className="text-xs text-neutral-400">Verifikasi dokumen KYC penjual, kelola pengguna, dan siarkan pengumuman resmi.</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="bg-white/10 px-3 py-1.5 rounded-xl text-center border border-white/10">
              <p className="text-xs font-black text-amber-400">{pendingCount}</p>
              <p className="text-[8px] font-bold text-neutral-400 uppercase">KYC Pending</p>
            </div>
            <div className="bg-white/10 px-3 py-1.5 rounded-xl text-center border border-white/10">
              <p className="text-xs font-black text-white">{users.length}</p>
              <p className="text-[8px] font-bold text-neutral-400 uppercase">Total User</p>
            </div>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="flex space-x-3 mt-6 border-b border-white/15 overflow-x-auto scrollbar-none text-xs font-bold">
          <button 
            onClick={() => setActiveTab('kyc')}
            className={`pb-2.5 transition-all flex items-center space-x-2 relative cursor-pointer ${
              activeTab === 'kyc' ? 'text-amber-400 font-black' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <i className="fas fa-id-card"></i>
            <span>Verifikasi Penjual (KYC)</span>
            {pendingCount > 0 && (
              <span className="bg-amber-400 text-black text-[9px] font-black px-1.5 py-0.2 rounded-full animate-pulse">
                {pendingCount}
              </span>
            )}
            {activeTab === 'kyc' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400 rounded-full shadow-md shadow-amber-400"></div>}
          </button>

          <button 
            onClick={() => setActiveTab('users')}
            className={`pb-2.5 transition-all flex items-center space-x-2 relative cursor-pointer ${
              activeTab === 'users' ? 'text-amber-400 font-black' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <i className="fas fa-users-gear"></i>
            <span>Kelola Pengguna & Role</span>
            {activeTab === 'users' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400 rounded-full shadow-md shadow-amber-400"></div>}
          </button>

          <button 
            onClick={() => setActiveTab('broadcast')}
            className={`pb-2.5 transition-all flex items-center space-x-2 relative cursor-pointer ${
              activeTab === 'broadcast' ? 'text-amber-400 font-black' : 'text-neutral-400 hover:text-white'
            }`}
          >
            <i className="fas fa-bullhorn"></i>
            <span>Broadcast Center</span>
            {activeTab === 'broadcast' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400 rounded-full shadow-md shadow-amber-400"></div>}
          </button>
        </div>
      </div>

      {/* ============================================================= */}
      {/* TAB 1: KYC SELLER VERIFICATION / VERIFIKASI AKUN TOKO */}
      {/* ============================================================= */}
      {activeTab === 'kyc' && (
        <div className="space-y-4">
          {/* FILTER & SEARCH */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 text-xs"></i>
              <input 
                type="text" 
                value={kycSearch}
                onChange={(e) => setKycSearch(e.target.value)}
                placeholder="Cari berdasarkan nama pemilik, WhatsApp, nama toko, kota, provinsi..."
                className="w-full bg-white border border-neutral-300 rounded-2xl pl-9 pr-8 py-2.5 text-xs font-bold focus:outline-none focus:border-black shadow-xs"
              />
              {kycSearch && (
                <button onClick={() => setKycSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-black text-xs">
                  <i className="fas fa-xmark"></i>
                </button>
              )}
            </div>

            {/* STATUS FILTER PILLS */}
            <div className="flex items-center space-x-1.5 bg-white p-1 rounded-2xl border border-neutral-200 shrink-0 overflow-x-auto">
              <button
                onClick={() => setKycFilter('pending')}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all flex items-center space-x-1 ${
                  kycFilter === 'pending' ? 'bg-amber-400 text-black shadow-xs' : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                <span>Menunggu ({pendingCount})</span>
              </button>
              <button
                onClick={() => setKycFilter('approved')}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all flex items-center space-x-1 ${
                  kycFilter === 'approved' ? 'bg-emerald-600 text-white shadow-xs' : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                <span>Disetujui ({sellerApplications.filter(a => a.status === 'approved').length})</span>
              </button>
              <button
                onClick={() => setKycFilter('rejected')}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all flex items-center space-x-1 ${
                  kycFilter === 'rejected' ? 'bg-red-600 text-white shadow-xs' : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                <span>Ditolak ({sellerApplications.filter(a => a.status === 'rejected').length})</span>
              </button>
              <button
                onClick={() => setKycFilter('all')}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all flex items-center space-x-1 ${
                  kycFilter === 'all' ? 'bg-black text-white shadow-xs' : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                <span>Semua ({sellerApplications.length})</span>
              </button>
            </div>
          </div>

          {/* LIST OF SELLER APPLICATIONS */}
          <div className="space-y-4">
            {filteredKycApps.length === 0 ? (
              <div className="bg-white rounded-3xl border border-neutral-200 p-12 text-center space-y-2 shadow-xs">
                <div className="w-16 h-16 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-400 text-2xl mx-auto shadow-inner">
                  <i className="fas fa-clipboard-check"></i>
                </div>
                <h3 className="font-black text-sm text-neutral-800 uppercase">Tidak Ada Data Pengajuan</h3>
                <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                  {kycSearch ? 'Tidak ada data pengajuan yang cocok dengan pencarian Anda.' : 'Belum ada pengajuan verifikasi akun toko pada status ini.'}
                </p>
              </div>
            ) : (
              filteredKycApps.map((app) => {
                const isPending = app.status === 'pending';
                const isApproved = app.status === 'approved';
                const isRejected = app.status === 'rejected';

                // Clean WA format for quick WhatsApp link
                const cleanPhone = (app.phoneWhatsapp || '').replace(/\D/g, '');
                const waFormatted = cleanPhone.startsWith('0') ? `62${cleanPhone.slice(1)}` : cleanPhone;

                return (
                  <div
                    key={app.id || app.userId}
                    className={`bg-white border-2 rounded-3xl p-4 sm:p-5 shadow-sm space-y-4 transition-all ${
                      isPending ? 'border-amber-400 bg-amber-50/20' : isApproved ? 'border-emerald-200' : 'border-neutral-200'
                    }`}
                  >
                    {/* Header: User Profile & Status Pill */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-neutral-100 pb-3">
                      <div className="flex items-center space-x-3 min-w-0">
                        <img
                          src={app.userPhoto || `https://api.dicebear.com/7.x/initials/svg?seed=${app.userId}`}
                          alt={app.userName}
                          className="w-12 h-12 rounded-2xl border-2 border-neutral-300 object-cover shrink-0 cursor-pointer"
                          onClick={() => onUserClick(app.userId)}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center space-x-2">
                            <h4 
                              onClick={() => onUserClick(app.userId)}
                              className="font-black text-sm sm:text-base text-neutral-900 uppercase truncate hover:underline cursor-pointer"
                            >
                              {app.fullName}
                            </h4>
                            <span className="text-[10px] text-neutral-400 font-bold">(@{app.userName})</span>
                          </div>
                          <p className="text-[10px] text-neutral-500 font-semibold">{app.userEmail}</p>
                          <p className="text-[9px] text-neutral-400 font-medium mt-0.5">
                            Diajukan: {app.submittedAt ? new Date(app.submittedAt).toLocaleString('id-ID') : 'Baru saja'}
                          </p>
                        </div>
                      </div>

                      {/* Status badge */}
                      <div className="self-start sm:self-center">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center space-x-1.5 shadow-xs ${
                          isApproved ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' :
                          isPending ? 'bg-amber-400 text-black border border-amber-500 animate-pulse' :
                          'bg-red-100 text-red-800 border border-red-300'
                        }`}>
                          <i className={`fas ${isApproved ? 'fa-circle-check text-emerald-600' : isPending ? 'fa-clock text-black' : 'fa-circle-xmark text-red-600'}`}></i>
                          <span>{isApproved ? 'Disetujui' : isPending ? 'Menunggu Review' : 'Ditolak'}</span>
                        </span>
                      </div>
                    </div>

                    {/* TWO COLUMN DETAILS GRID */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
                      {/* Box 1: Owner Identity & Location */}
                      <div className="bg-neutral-50 border border-neutral-200/90 rounded-2xl p-3.5 space-y-2">
                        <div className="flex items-center space-x-1.5 text-amber-700 font-black text-xs uppercase tracking-wider border-b border-neutral-200 pb-1.5">
                          <i className="fas fa-user-check text-amber-600"></i>
                          <span>Data Pemilik & Lokasi Domisili</span>
                        </div>

                        <div className="space-y-1.5 text-[11px] text-neutral-700">
                          <div className="flex justify-between">
                            <span className="text-neutral-400 font-bold">Nama Lengkap:</span>
                            <span className="font-extrabold text-neutral-900">{app.fullName}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-neutral-400 font-bold">Nomor Telepon / WA:</span>
                            <div className="flex items-center space-x-1.5">
                              <span className="font-bold text-neutral-900">{app.phoneWhatsapp || '-'}</span>
                              {cleanPhone && (
                                <a
                                  href={`https://wa.me/${waFormatted}?text=Halo%20${encodeURIComponent(app.fullName)},%20kami%20dari%20Tim%20Admin%20Vimos%20mengenai%20verifikasi%20toko%20Anda.`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black px-2 py-0.5 rounded-md flex items-center space-x-1 shadow-xs"
                                  title="Chat via WhatsApp"
                                >
                                  <i className="fab fa-whatsapp"></i>
                                  <span>WA</span>
                                </a>
                              )}
                            </div>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-neutral-400 font-bold">Kota & Provinsi:</span>
                            <span className="font-bold text-neutral-900">{app.city || '-'}, {app.province || '-'}</span>
                          </div>
                          <div className="pt-1 border-t border-neutral-200">
                            <span className="text-neutral-400 font-bold block mb-0.5">Alamat Lengkap Domisili:</span>
                            <p className="font-medium text-neutral-800 bg-white p-2 rounded-xl border border-neutral-200 leading-snug">
                              {app.address || '-'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Box 2: Proposed Shop Details */}
                      <div className="bg-neutral-50 border border-neutral-200/90 rounded-2xl p-3.5 space-y-2">
                        <div className="flex items-center space-x-1.5 text-amber-700 font-black text-xs uppercase tracking-wider border-b border-neutral-200 pb-1.5">
                          <i className="fas fa-store text-amber-600"></i>
                          <span>Informasi Toko yang Diajukan</span>
                        </div>

                        <div className="space-y-1.5 text-[11px] text-neutral-700">
                          <div className="flex justify-between">
                            <span className="text-neutral-400 font-bold">Nama Toko:</span>
                            <span className="font-black text-neutral-900 text-xs">{app.shopName}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-neutral-400 font-bold">Kategori Utama:</span>
                            <span className="bg-amber-100 text-amber-900 font-extrabold px-2 py-0.5 rounded-md text-[10px]">
                              {app.shopCategory || 'Umum'}
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-400 font-bold block mb-0.5">Deskripsi Toko:</span>
                            <p className="font-medium text-neutral-800 bg-white p-2 rounded-xl border border-neutral-200 leading-snug">
                              {app.shopDescription || 'Tidak ada deskripsi.'}
                            </p>
                          </div>
                          {isRejected && app.rejectionReason && (
                            <div className="p-2 bg-red-50 border border-red-200 rounded-xl text-red-700">
                              <span className="font-bold block text-[10px] uppercase">Alasan Penolakan:</span>
                              <p className="text-[11px] font-medium">{app.rejectionReason}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* OWNER PHOTO PREVIEW */}
                    <div className="bg-neutral-100/70 p-3.5 rounded-2xl border border-neutral-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase text-neutral-800 flex items-center space-x-1.5">
                          <i className="fas fa-camera text-neutral-600"></i>
                          <span>Foto Pengguna / Pemilik Toko</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        {/* Owner Photo */}
                        <div 
                          onClick={() => setFullscreenDoc({ url: app.ownerPhotoURL || app.userPhoto || '', title: 'Foto Pengguna / Pemilik Toko', applicantName: app.fullName })}
                          className="bg-white border-2 border-dashed border-neutral-300 hover:border-black rounded-2xl p-2 cursor-pointer group transition-all w-48 shrink-0"
                        >
                          <div className="h-28 bg-neutral-900 rounded-xl overflow-hidden relative">
                            {app.ownerPhotoURL || app.userPhoto ? (
                              <img src={app.ownerPhotoURL || app.userPhoto} alt="Foto Pengguna" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-neutral-500 text-xs font-bold">
                                Tidak ada foto
                              </div>
                            )}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                              <span className="bg-black/80 text-white text-[9px] font-black px-2.5 py-1 rounded-full flex items-center space-x-1">
                                <i className="fas fa-expand"></i>
                                <span>Perbesar Foto</span>
                              </span>
                            </div>
                          </div>
                          <p className="text-center text-[10px] font-black text-neutral-700 mt-1.5 uppercase">
                            📷 Foto Profil / Pemilik
                          </p>
                        </div>

                        <div className="text-[11px] text-neutral-600 space-y-1">
                          <div className="p-2.5 bg-white rounded-xl border border-neutral-200 shadow-2xs">
                            <span className="text-amber-800 font-bold block text-[10px] uppercase">🔒 Privasi Terjaga:</span>
                            <span>Verifikasi dilakukan tanpa dokumen KTP demi menjaga keamanan privasi pengguna dari risiko kebocoran identitas.</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ADMIN ACTION CONTROLS */}
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-neutral-100">
                      {isPending && (
                        <>
                          <button
                            onClick={() => {
                              setRejectingApp(app);
                              setRejectionReasonInput('');
                            }}
                            className="px-4 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 rounded-xl text-xs font-black uppercase transition-all active:scale-95 flex items-center space-x-1.5 cursor-pointer"
                          >
                            <i className="fas fa-xmark"></i>
                            <span>Tolak Pengajuan</span>
                          </button>
                          <button
                            onClick={() => handleApproveSeller(app)}
                            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md active:scale-95 flex items-center space-x-1.5 cursor-pointer"
                          >
                            <i className="fas fa-check"></i>
                            <span>Setujui Akun Toko</span>
                          </button>
                        </>
                      )}

                      {isApproved && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                            ✅ Toko Aktif & Terverifikasi
                          </span>
                          <button
                            onClick={() => handleDeleteShopAndRevokeByAdmin(app)}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-[10px] font-black rounded-xl uppercase transition-all shadow-xs flex items-center space-x-1 cursor-pointer"
                            title="Hapus Toko & Produk"
                          >
                            <i className="fas fa-trash-can text-[9px]"></i>
                            <span>Hapus Toko & Produk</span>
                          </button>
                        </div>
                      )}

                      {isRejected && (
                        <button
                          onClick={() => handleApproveSeller(app)}
                          className="px-4 py-2 bg-neutral-900 hover:bg-black text-white rounded-xl text-xs font-black uppercase transition-all active:scale-95 flex items-center space-x-1"
                        >
                          <i className="fas fa-rotate-left text-xs text-amber-400"></i>
                          <span>Setujui Ulang</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ============================================================= */}
      {/* TAB 2: USER ORCHESTRATION & ROLES */}
      {/* ============================================================= */}
      {activeTab === 'users' && (
        <>
          <div className="relative mb-6">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-black opacity-30">
              <i className="fas fa-filter text-xs"></i>
            </span>
            <input 
              type="text" 
              value={adminSearch}
              onChange={(e) => setAdminSearch(e.target.value)}
              placeholder="Filter by name or email..."
              className="w-full bg-gray-50 border-2 border-black rounded-2xl pl-10 pr-4 py-3 text-xs focus:outline-none focus:ring-0 transition-all font-bold"
            />
          </div>

          <div className="space-y-3">
            {filteredUsers.length === 0 ? (
              <div className="py-20 text-center opacity-20">
                <i className="fas fa-search-minus text-4xl mb-4"></i>
                <p className="font-black uppercase tracking-widest text-xs">No records found</p>
              </div>
            ) : (
              filteredUsers.map((user) => (
                <div key={user.id} className="p-4 border-2 border-black rounded-2xl bg-white shadow-sm flex flex-col space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <img 
                        src={user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.name || 'User')}`} 
                        className={`w-12 h-12 rounded-full border-2 border-black object-cover cursor-pointer ${user.isBanned ? 'grayscale opacity-30' : ''}`}
                        onClick={() => onUserClick(user.id)}
                        alt={user.name}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 flex-wrap">
                          <h4 className={`font-black uppercase tracking-tighter truncate ${user.isBanned ? 'text-gray-400 line-through' : 'text-black'}`}>
                            {user.name}
                          </h4>
                          {user.isAdmin && <span className="bg-yellow-400 text-black text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter">Admin</span>}
                          {user.isVerifiedSeller && <span className="bg-amber-500 text-white text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter">Merchant</span>}
                          {user.role && <span className="text-white text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter" style={{ backgroundColor: user.roleColor || '#000000' }}>{user.role}</span>}
                        </div>
                        <p className="text-[9px] font-bold text-gray-400 truncate uppercase tracking-widest">{user.email}</p>
                      </div>
                    </div>
                    {user.isBanned && <span className="text-[8px] font-black text-red-600 border border-red-600 px-2 py-1 rounded-full uppercase tracking-tighter">Banished</span>}
                  </div>

                  {/* Countdown Status Hapus Otomatis (30 Hari Inaktif) */}
                  {(() => {
                    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
                    const lastActive = Math.max(user.lastSeen || 0, user.createdAt || 0, 0);
                    const elapsed = lastActive ? Date.now() - lastActive : 0;
                    const remainingMs = Math.max(0, THIRTY_DAYS_MS - elapsed);
                    const daysLeft = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
                    const hoursLeft = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

                    return (
                      <div className="flex items-center justify-between text-[10px] bg-neutral-50 px-3 py-2 rounded-xl border border-neutral-200">
                        <span className="text-neutral-500 font-bold flex items-center space-x-1.5">
                          <i className="fas fa-hourglass-half text-neutral-400"></i>
                          <span>Waktu Hapus Otomatis:</span>
                        </span>
                        {user.isAdmin ? (
                          <span className="font-extrabold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200 text-[9px] uppercase tracking-wider">
                            🛡️ Terlindungi (Admin)
                          </span>
                        ) : user.isOnline ? (
                          <span className="font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200 text-[9px] uppercase tracking-wider flex items-center space-x-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span>Online (Aman 30 Hari)</span>
                          </span>
                        ) : (
                          <span className={`font-black px-2 py-0.5 rounded-lg border text-[9px] uppercase tracking-wider ${
                            daysLeft <= 3 
                              ? 'text-red-700 bg-red-50 border-red-300 animate-pulse' 
                              : daysLeft <= 10 
                              ? 'text-amber-700 bg-amber-50 border-amber-300' 
                              : 'text-neutral-700 bg-white border-neutral-200'
                          }`}>
                            {daysLeft <= 3 
                              ? `⚠️ Sisa ${daysLeft} hari ${hoursLeft} jam (Segera Terhapus)` 
                              : `Sisa ${daysLeft} hari lagi`}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  <div className="flex flex-wrap items-center gap-2">
                    <button 
                      onClick={() => onToggleAdmin && onToggleAdmin(user.id, Boolean(user.isAdmin))} 
                      className={`flex-1 py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs flex items-center justify-center space-x-1 ${
                        user.isAdmin 
                          ? 'bg-amber-400 border-2 border-black text-black hover:bg-amber-500' 
                          : 'bg-neutral-900 border-2 border-black text-white hover:bg-black'
                      }`}
                    >
                      <i className={`fas ${user.isAdmin ? 'fa-shield-minus' : 'fa-shield-halved'} text-xs`}></i>
                      <span>{user.isAdmin ? 'Cabut Akses Admin' : 'Jadikan Admin'}</span>
                    </button>
                    <button onClick={() => { setEditingRoleUser(user); setNewRoleValue(user.role || ''); setNewRoleColor(user.roleColor || '#000000'); }} className="flex-1 bg-white border-2 border-black text-black py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black hover:text-white transition-all cursor-pointer">Set Role</button>
                    <button onClick={() => onBanUser(user.id)} className={`flex-1 border-2 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${user.isBanned ? 'border-green-600 text-green-600 hover:bg-green-600 hover:text-white' : 'border-red-600 text-red-600 hover:bg-red-600 hover:text-white'}`}>{user.isBanned ? 'Restore' : 'Banish'}</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ============================================================= */}
      {/* TAB 3: BROADCAST CENTER */}
      {/* ============================================================= */}
      {activeTab === 'broadcast' && (
        <div className="space-y-8">
          <form onSubmit={handleBroadcastSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest opacity-40">Proclamation Message</label>
              <textarea 
                value={broadcastText}
                onChange={(e) => setBroadcastText(e.target.value)}
                placeholder="What must the Orbit know?"
                className="w-full bg-gray-50 border-2 border-black rounded-2xl p-4 text-sm font-bold focus:outline-none focus:bg-white transition-all h-32 resize-none"
              />
            </div>
            <div className="flex space-x-2">
              {editingAnnId && (
                <button 
                  type="button" 
                  onClick={() => { setEditingAnnId(null); setBroadcastText(''); }}
                  className="px-6 border-2 border-black rounded-xl text-[10px] font-black uppercase tracking-widest"
                >
                  Cancel
                </button>
              )}
              <button 
                type="submit"
                className="flex-1 bg-black text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all cursor-pointer"
              >
                {editingAnnId ? 'Update Proclamation' : 'Post Proclamation'}
              </button>
            </div>
          </form>

          <div className="space-y-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Active Proclamations</h3>
            {announcements.length === 0 ? (
              <p className="text-center py-10 text-[10px] text-gray-300 font-black uppercase tracking-widest">Silence persists...</p>
            ) : (
              announcements.map(ann => (
                <div key={ann.id} className="p-4 border-2 border-black rounded-2xl bg-white shadow-sm space-y-3">
                  <p className="text-sm font-bold">{ann.text}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">{new Date(ann.timestamp).toLocaleString()}</span>
                    <div className="flex space-x-2">
                      <button onClick={() => startEditAnn(ann)} className="text-[8px] font-black uppercase tracking-widest bg-gray-100 px-3 py-1 rounded-full cursor-pointer">Edit</button>
                      <button onClick={() => onDeleteAnnouncement(ann.id)} className="text-[8px] font-black uppercase tracking-widest bg-red-50 text-red-600 px-3 py-1 rounded-full cursor-pointer">Delete</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* FULLSCREEN DOCUMENT VIEWER MODAL */}
      {fullscreenDoc && (
        <div 
          className="fixed inset-0 z-[160] bg-black/95 backdrop-blur-md flex flex-col items-center justify-between p-4 sm:p-6 animate-fade-in"
          onClick={() => setFullscreenDoc(null)}
        >
          <div className="w-full max-w-4xl flex items-center justify-between py-2 text-white z-10" onClick={(e) => e.stopPropagation()}>
            <div>
              <p className="font-extrabold text-sm text-white">{fullscreenDoc.title}</p>
              <p className="text-xs text-neutral-400">Pemilik: {fullscreenDoc.applicantName}</p>
            </div>
            <button 
              onClick={() => setFullscreenDoc(null)}
              className="w-10 h-10 rounded-full bg-neutral-800 hover:bg-red-600 text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <i className="fas fa-xmark text-lg"></i>
            </button>
          </div>

          <div className="flex-1 flex items-center justify-center max-w-4xl w-full my-auto overflow-hidden p-2" onClick={(e) => e.stopPropagation()}>
            <img 
              src={fullscreenDoc.url} 
              alt={fullscreenDoc.title}
              className="max-h-[80vh] max-w-full object-contain rounded-2xl shadow-2xl ring-1 ring-white/20 animate-scale-up"
            />
          </div>

          <div className="text-neutral-400 text-xs py-2">
            Klik di luar gambar atau tombol X untuk menutup
          </div>
        </div>
      )}

      {/* REJECTION REASON MODAL */}
      {rejectingApp && (
        <div className="fixed inset-0 z-[150] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-neutral-100 space-y-4 animate-scale-up">
            <div className="flex items-center space-x-3 text-red-600">
              <div className="w-10 h-10 rounded-2xl bg-red-100 flex items-center justify-center text-lg">
                <i className="fas fa-triangle-exclamation"></i>
              </div>
              <div>
                <h3 className="font-black text-base text-neutral-900">Tolak Pengajuan Toko</h3>
                <p className="text-xs text-neutral-500">{rejectingApp.fullName} ({rejectingApp.shopName})</p>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase text-neutral-600 block mb-1">
                Catatan Alasan Penolakan (Akan dikirim ke pengguna):
              </label>
              <textarea
                rows={3}
                placeholder="Misal: Foto KTP buram, nomor NIK tidak terbaca, mohon foto ulang dengan pencahayaan terang..."
                value={rejectionReasonInput}
                onChange={(e) => setRejectionReasonInput(e.target.value)}
                className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-3 text-xs font-medium focus:outline-none focus:border-black focus:bg-white resize-none"
              />
            </div>

            <div className="flex space-x-2 pt-1">
              <button
                onClick={() => setRejectingApp(null)}
                className="flex-1 py-3 rounded-2xl border border-neutral-300 text-neutral-700 text-xs font-bold hover:bg-neutral-100 cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={handleRejectSeller}
                className="flex-1 py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider shadow-md active:scale-95 cursor-pointer"
              >
                Kirim Penolakan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT ROLE MODAL */}
      {editingRoleUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border-4 border-black w-full max-w-sm rounded-3xl overflow-hidden shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] flex flex-col">
            <div className="p-6 border-b-4 border-black bg-black text-white">
              <h3 className="font-black uppercase tracking-[0.2em] text-sm">Update Destiny</h3>
              <p className="text-[8px] uppercase tracking-widest opacity-60 mt-1">Assign role to {editingRoleUser.name}</p>
            </div>
            <div className="p-6 space-y-4">
              <input type="text" autoFocus value={newRoleValue} onChange={(e) => setNewRoleValue(e.target.value)} placeholder="Role Name" className="w-full bg-gray-50 border-2 border-black rounded-xl p-4 font-bold focus:outline-none" />
              <div className="flex flex-wrap gap-2 p-2 bg-gray-50 rounded-xl">
                {PRESET_COLORS.map(color => (
                  <button key={color} onClick={() => setNewRoleColor(color)} className={`w-7 h-7 rounded-full border-2 ${newRoleColor === color ? 'border-black scale-110' : 'border-transparent'}`} style={{ backgroundColor: color === '#00000000' ? '#fff' : color }} />
                ))}
              </div>
              <div className="flex space-x-2">
                <button onClick={() => setEditingRoleUser(null)} className="flex-1 border-2 border-black p-3 rounded-xl font-black uppercase text-xs cursor-pointer">Cancel</button>
                <button onClick={() => { onSetRole(editingRoleUser.id, newRoleValue.trim(), newRoleColor); setEditingRoleUser(null); }} className="flex-1 bg-black text-white p-3 rounded-xl font-black uppercase text-xs cursor-pointer">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
