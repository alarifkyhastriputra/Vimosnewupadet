import React, { useState, useEffect, useMemo } from 'react';
import { User, UserShop, ShopItem, ShopOrder, SellerApplication } from '../types.ts';
import { useLanguage } from '../LanguageContext.tsx';
import { ref, onValue, push, set, update, remove, serverTimestamp, get, query, limitToLast } from 'firebase/database';
import { db } from '../firebase.ts';
import { compressImage } from '../services/imageCompressor.ts';

// High-performance persistent memory cache for instant, 0-latency Shop loading
let memShops: UserShop[] | null = null;
let memItems: ShopItem[] | null = null;
let memOrders: ShopOrder[] | null = null;
let memMyApp: SellerApplication | null = null;

const CACHE_KEY_SHOPS = 'vimos_shop_cache_shops_v1';
const CACHE_KEY_ITEMS = 'vimos_shop_cache_items_v1';
const CACHE_KEY_ORDERS = 'vimos_shop_cache_orders_v1';
const CACHE_KEY_APP = 'vimos_shop_cache_app_v1';

const getLocalCache = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const setLocalCache = (key: string, data: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {}
};

export const SHOP_ITEMS: any[] = [];

interface ShopProps {
  currentUser: User;
  onUpdateUser: (updatedData: Partial<User>) => void;
  onNavigateToChat?: (targetUserId: string, initialMessage?: string) => void;
}

export const Shop: React.FC<ShopProps> = ({ currentUser, onUpdateUser, onNavigateToChat }) => {
  const { t } = useLanguage();
  
  const initialShops = memShops || getLocalCache<UserShop[]>(CACHE_KEY_SHOPS) || [];
  const initialItems = memItems || getLocalCache<ShopItem[]>(CACHE_KEY_ITEMS) || [];
  const initialOrders = memOrders || getLocalCache<ShopOrder[]>(CACHE_KEY_ORDERS) || [];
  const initialApp = memMyApp || getLocalCache<SellerApplication>(CACHE_KEY_APP) || null;

  // Realtime Data from Firebase with instant cache hydration
  const [shops, setShops] = useState<UserShop[]>(initialShops);
  const [items, setItems] = useState<ShopItem[]>(initialItems);
  const [orders, setOrders] = useState<ShopOrder[]>(initialOrders);
  const [loadingData, setLoadingData] = useState<boolean>(initialItems.length === 0 && initialShops.length === 0);

  // User's KYC Seller Application state
  const [myApplication, setMyApplication] = useState<SellerApplication | null>(initialApp);

  // Active Navigation
  const [activeTab, setActiveTab] = useState<'explore' | 'my_shop' | 'orders'>('explore');
  const [exploreSubTab, setExploreSubTab] = useState<'items' | 'shops'>('items');
  const [ordersSubTab, setOrdersSubTab] = useState<'incoming' | 'my_purchases' | 'guide'>('incoming');
  const [selectedShopFilter, setSelectedShopFilter] = useState<UserShop | null>(null);

  // Search, Category & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'price_asc' | 'price_desc' | 'name_asc'>('newest');

  // Purchase Modal State
  const [selectedItemToBuy, setSelectedItemToBuy] = useState<ShopItem | null>(null);
  const [buyQuantity, setBuyQuantity] = useState(1);
  const [buyerNotes, setBuyerNotes] = useState('');
  const [isProcessingOrder, setIsProcessingOrder] = useState(false);

  // Seller Verification Registration Form State (Photo Pengguna, Nomor Telepon, Lokasi)
  const [isFillingKYC, setIsFillingKYC] = useState(false);
  const [kycFullName, setKycFullName] = useState(currentUser.name || '');
  const [kycOwnerPhoto, setKycOwnerPhoto] = useState(currentUser.photoURL || '');
  const [kycPhoneWA, setKycPhoneWA] = useState('');
  const [kycProvince, setKycProvince] = useState('DKI Jakarta');
  const [kycCity, setKycCity] = useState('');
  const [kycAddress, setKycAddress] = useState('');
  const [kycShopName, setKycShopName] = useState('');
  const [kycShopCategory, setKycShopCategory] = useState('Fashion');
  const [kycShopDesc, setKycShopDesc] = useState('');
  const [kycShopBanner, setKycShopBanner] = useState('');
  const [isCompressingOwnerPhoto, setIsCompressingOwnerPhoto] = useState(false);
  const [isSubmittingKYC, setIsSubmittingKYC] = useState(false);

  // Shop Edit Form State (for approved sellers)
  const [isEditingShop, setIsEditingShop] = useState(false);
  const [shopNameInput, setShopNameInput] = useState('');
  const [shopDescInput, setShopDescInput] = useState('');
  const [shopBannerInput, setShopBannerInput] = useState('');
  const [isCompressingBanner, setIsCompressingBanner] = useState(false);

  // Item Form State (for approved sellers)
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemCategory, setItemCategory] = useState('Fashion');
  const [itemImage, setItemImage] = useState('');
  const [itemStock, setItemStock] = useState('10');
  const [isCompressingItemPhoto, setIsCompressingItemPhoto] = useState(false);

  // Toast Banner
  const [notificationMsg, setNotificationMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Custom Confirmation Modal Pop-Up State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
    confirmText?: string;
  } | null>(null);

  const myShop = useMemo(() => shops.find(s => s.ownerId === currentUser.id), [shops, currentUser.id]);
  const isVerifiedSeller = Boolean(currentUser.isVerifiedSeller || myApplication?.status === 'approved' || myShop?.isVerified);
  const myShopItems = useMemo(() => myShop ? items.filter(i => i.shopId === myShop.id) : [], [myShop, items]);

  // Incoming Orders (User is Seller) & Outgoing Orders (User is Buyer)
  const incomingOrders = useMemo(() => orders.filter(o => o.sellerId === currentUser.id), [orders, currentUser.id]);
  const myPurchases = useMemo(() => orders.filter(o => o.buyerId === currentUser.id), [orders, currentUser.id]);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setNotificationMsg({ text, type });
    setTimeout(() => {
      setNotificationMsg(null);
    }, 3500);
  };

  // Helper file uploader with smooth client-side compressor
  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>, 
    setCompressing: (b: boolean) => void,
    callback: (url: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCompressing(true);
    try {
      const compressed = await compressImage(file, 800, 800, 0.76);
      callback(compressed);
      showToast('Foto berhasil diproses & diunggah!', 'success');
    } catch (err) {
      console.error('Failed to compress image:', err);
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          callback(reader.result);
          showToast('Foto berhasil diunggah!');
        }
      };
      reader.readAsDataURL(file);
    } finally {
      setCompressing(false);
      if (e.target) e.target.value = '';
    }
  };

  // Subscribe to Shops, Items, Orders, and Seller KYC Application from Firebase with seamless cache sync
  useEffect(() => {
    const shopsRef = ref(db, 'shops');
    const itemsRef = ref(db, 'shopItems');
    const ordersRef = query(ref(db, 'shopOrders'), limitToLast(120));
    const myAppRef = ref(db, `sellerApplications/${currentUser.id}`);

    const unsubShops = onValue(shopsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list: UserShop[] = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val
        })).sort((a, b) => b.createdAt - a.createdAt);
        memShops = list;
        setShops(list);
        setLocalCache(CACHE_KEY_SHOPS, list);
      } else {
        memShops = [];
        setShops([]);
      }
    }, (error) => console.warn('Shops listener error:', error));

    const unsubItems = onValue(itemsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list: ShopItem[] = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val
        })).sort((a, b) => b.createdAt - a.createdAt);
        memItems = list;
        setItems(list);
        setLocalCache(CACHE_KEY_ITEMS, list);
      } else {
        memItems = [];
        setItems([]);
      }
      setLoadingData(false);
    }, (error) => {
      console.warn('Items listener error:', error);
      setLoadingData(false);
    });

    const unsubOrders = onValue(ordersRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list: ShopOrder[] = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val
        })).sort((a, b) => b.timestamp - a.timestamp);
        memOrders = list;
        setOrders(list);
        setLocalCache(CACHE_KEY_ORDERS, list);
      } else {
        memOrders = [];
        setOrders([]);
      }
    }, (error) => console.warn('Orders listener error:', error));

    const unsubMyApp = onValue(myAppRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        memMyApp = data as SellerApplication;
        setMyApplication(data as SellerApplication);
        setLocalCache(CACHE_KEY_APP, data);
        if (data.status === 'approved' && !currentUser.isVerifiedSeller) {
          onUpdateUser({ isVerifiedSeller: true, sellerStatus: 'approved' });
        }
      } else {
        memMyApp = null;
        setMyApplication(null);
      }
    });

    return () => {
      unsubShops();
      unsubItems();
      unsubOrders();
      unsubMyApp();
    };
  }, [currentUser.id]);

  useEffect(() => {
    if (myShop) {
      setShopNameInput(myShop.shopName || '');
      setShopDescInput(myShop.description || '');
      setShopBannerInput(myShop.bannerURL || '');
    }
  }, [myShop]);

  // Auto sync form defaults when currentUser is loaded
  useEffect(() => {
    if (currentUser) {
      if (!kycFullName && currentUser.name) setKycFullName(currentUser.name);
      if (!kycOwnerPhoto && currentUser.photoURL) setKycOwnerPhoto(currentUser.photoURL);
    }
  }, [currentUser]);

  // Submit Seller Verification Application to Admin
  const handleSubmitKYCApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !currentUser.id) {
      showToast('Sesi login tidak terdeteksi. Silakan muat ulang halaman.', 'error');
      return;
    }

    const trimmedFullName = kycFullName.trim() || currentUser.name || 'Pemilik Toko';
    const trimmedPhoneWA = kycPhoneWA.trim();
    const trimmedAddress = kycAddress.trim();
    const trimmedShopName = kycShopName.trim();

    if (!trimmedFullName || !trimmedPhoneWA || !trimmedAddress || !trimmedShopName) {
      showToast('Harap isi Nama Pemilik, Nomor WhatsApp, Alamat Domisili, dan Nama Toko.', 'error');
      return;
    }

    const photoToUse = kycOwnerPhoto.trim() || currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(trimmedFullName)}`;

    setIsSubmittingKYC(true);
    const now = Date.now();
    const applicationData: SellerApplication = {
      id: `app_${currentUser.id}`,
      userId: currentUser.id,
      userName: currentUser.name || trimmedFullName,
      userEmail: currentUser.email || '',
      userPhoto: currentUser.photoURL || photoToUse,
      fullName: trimmedFullName,
      ownerPhotoURL: photoToUse,
      phoneWhatsapp: trimmedPhoneWA,
      province: kycProvince.trim() || 'Indonesia',
      city: kycCity.trim() || 'Kota',
      address: trimmedAddress,
      shopName: trimmedShopName,
      shopCategory: kycShopCategory || 'Fashion',
      shopDescription: kycShopDesc.trim() || 'Toko Resmi Vimos',
      shopBannerURL: kycShopBanner.trim() || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&auto=format&fit=crop&q=80',
      status: 'pending',
      submittedAt: now
    };

    try {
      // Clean object to ensure NO undefined keys exist before Firebase RTDB call
      const sanitizedApp = JSON.parse(JSON.stringify(applicationData));

      // 1. Save application to database under private isolated node
      await set(ref(db, `sellerApplications/${currentUser.id}`), sanitizedApp);
      
      // 2. Update user status in database
      await update(ref(db, `users/${currentUser.id}`), {
        sellerStatus: 'pending',
        sellerApplicationId: sanitizedApp.id
      });

      // 3. Update local user state
      onUpdateUser({ sellerStatus: 'pending', sellerApplicationId: sanitizedApp.id });

      // 4. Update local state
      setMyApplication(sanitizedApp as SellerApplication);

      showToast('Pengajuan Akun Toko berhasil dikirim! Menunggu verifikasi Admin. 🎉', 'success');
      setIsFillingKYC(false);
    } catch (err: any) {
      console.error('Error submitting seller application:', err);
      showToast(`Gagal mengirim pengajuan: ${err?.message || 'Koneksi terganggu'}`, 'error');
    } finally {
      setIsSubmittingKYC(false);
    }
  };

  // Update Existing Shop Details (For Approved Sellers)
  const handleSaveShopInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myShop) return;
    if (!shopNameInput.trim()) {
      showToast('Nama toko tidak boleh kosong.', 'error');
      return;
    }

    try {
      await update(ref(db, `shops/${myShop.id}`), {
        shopName: shopNameInput.trim(),
        description: shopDescInput.trim(),
        bannerURL: shopBannerInput.trim() || myShop.bannerURL,
        ownerName: currentUser.name,
        ownerPhoto: currentUser.photoURL || ''
      });
      showToast('Profil toko berhasil diperbarui! 🎉', 'success');
      setIsEditingShop(false);
    } catch (err) {
      console.error('Error saving shop:', err);
      showToast('Gagal menyimpan toko.', 'error');
    }
  };

  // Add or Edit Item (For Approved Sellers)
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myShop || !isVerifiedSeller) {
      showToast('Akun toko Anda harus disetujui terlebih dahulu!', 'error');
      return;
    }

    if (!itemName.trim() || !itemPrice || isNaN(Number(itemPrice))) {
      showToast('Masukkan nama & harga barang (Rp) yang valid.', 'error');
      return;
    }

    const finalImage = itemImage.trim() || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80';
    const priceNum = Math.max(100, parseInt(itemPrice, 10));
    const stockNum = Math.max(1, parseInt(itemStock || '1', 10));

    try {
      if (editingItemId) {
        await update(ref(db, `shopItems/${editingItemId}`), {
          name: itemName.trim(),
          price: priceNum,
          description: itemDesc.trim() || 'Deskripsi produk berkualitas.',
          category: itemCategory,
          imageURL: finalImage,
          stock: stockNum
        });
        showToast('Produk berhasil diperbarui! ✨', 'success');
      } else {
        const newItemRef = push(ref(db, 'shopItems'));
        const newItem: ShopItem = {
          id: newItemRef.key!,
          shopId: myShop.id,
          ownerId: currentUser.id,
          ownerName: myShop.shopName || currentUser.name,
          name: itemName.trim(),
          price: priceNum,
          description: itemDesc.trim() || 'Deskripsi produk berkualitas tinggi.',
          category: itemCategory,
          imageURL: finalImage,
          stock: stockNum,
          createdAt: Date.now()
        };
        await set(newItemRef, newItem);
        showToast(`Produk "${newItem.name}" berhasil dipajang di etalase! 🛍️`, 'success');
      }

      // Reset form
      setItemName('');
      setItemPrice('');
      setItemDesc('');
      setItemCategory('Fashion');
      setItemImage('');
      setItemStock('10');
      setIsAddingItem(false);
      setEditingItemId(null);
    } catch (err) {
      console.error('Error saving item:', err);
      showToast('Gagal menyimpan produk.', 'error');
    }
  };

  const handleEditItemClick = (item: ShopItem) => {
    setEditingItemId(item.id);
    setItemName(item.name);
    setItemPrice(item.price.toString());
    setItemDesc(item.description);
    setItemCategory(item.category || 'Fashion');
    setItemImage(item.imageURL || '');
    setItemStock((item.stock ?? 10).toString());
    setIsAddingItem(true);
    setActiveTab('my_shop');
  };

  const handleQuickStockUpdate = async (itemId: string, delta: number) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const newStock = Math.max(0, (item.stock || 0) + delta);
    try {
      await update(ref(db, `shopItems/${itemId}`), { stock: newStock });
      showToast(`Stok "${item.name}" diupdate menjadi ${newStock}.`, 'info');
    } catch (err) {
      console.error('Failed to update stock:', err);
    }
  };

  const handleDeleteItem = (itemId: string, itemNameStr?: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Hapus Produk dari Toko?',
      message: `Apakah Anda yakin ingin menghapus produk ${itemNameStr ? `"${itemNameStr}"` : ''} dari etalase toko Anda?`,
      confirmText: 'Ya, Hapus Produk',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await remove(ref(db, `shopItems/${itemId}`));
          setItems(prev => prev.filter(i => i.id !== itemId));
          showToast('Produk berhasil dihapus dari etalase.', 'success');
        } catch (err) {
          console.error('Delete item error:', err);
          showToast('Gagal menghapus produk.', 'error');
        }
      }
    });
  };

  // Delete Shop & all products (For Shop Owner & Admin)
  const handleDeleteShop = (shopId: string, shopNameStr?: string, ownerId?: string) => {
    const isOwner = currentUser.id === ownerId || myShop?.id === shopId;
    const isAdmin = Boolean(currentUser.isAdmin);

    if (!isOwner && !isAdmin) {
      showToast('Anda tidak memiliki izin untuk menghapus toko ini.', 'error');
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: 'Hapus Toko & Semua Produk Permanen?',
      message: `Apakah Anda yakin ingin menghapus toko ${shopNameStr ? `"${shopNameStr}"` : ''}? Seluruh produk di etalase toko ini akan dihapus secara permanen.`,
      confirmText: 'Ya, Hapus Toko Permanen',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          // 1. Delete shop from RTDB
          await remove(ref(db, `shops/${shopId}`));

          // 2. Delete all shop items belonging to this shop
          const itemsToDelete = items.filter(i => i.shopId === shopId);
          for (const item of itemsToDelete) {
            await remove(ref(db, `shopItems/${item.id}`));
          }

          // 3. Reset owner status
          const targetOwnerId = ownerId || (isOwner ? currentUser.id : null);
          if (targetOwnerId) {
            await update(ref(db, `users/${targetOwnerId}`), {
              isVerifiedSeller: false,
              sellerStatus: 'unsubmitted',
              sellerApplicationId: null
            });
            await remove(ref(db, `sellerApplications/${targetOwnerId}`));

            if (targetOwnerId === currentUser.id) {
              onUpdateUser({ isVerifiedSeller: false, sellerStatus: 'unsubmitted', sellerApplicationId: undefined });
              setMyApplication(null);
            } else {
              // Send notification to the shop owner
              const notifRef = push(ref(db, `notifications/${targetOwnerId}`));
              await set(notifRef, {
                id: notifRef.key,
                senderId: currentUser.id,
                senderName: currentUser.name || 'Admin Vimos',
                senderPhoto: currentUser.photoURL || 'https://api.dicebear.com/7.x/bottts/svg?seed=vimos_admin',
                type: 'comment',
                commentText: `⚠️ Toko Anda "${shopNameStr || ''}" beserta produknya telah dihapus oleh Admin Vimos.`,
                timestamp: Date.now(),
                read: false
              });
            }
          }

          showToast(`Toko ${shopNameStr ? `"${shopNameStr}"` : ''} dan seluruh produknya berhasil dihapus.`, 'success');
        } catch (err) {
          console.error('Delete shop error:', err);
          showToast('Gagal menghapus toko.', 'error');
        }
      }
    });
  };

  // Buyer Ordering & Direct Chat Trigger
  const handleProceedBuyOrder = async () => {
    if (!selectedItemToBuy || !currentUser) return;
    const item = selectedItemToBuy;
    const qty = buyQuantity;

    if (item.ownerId === currentUser.id) {
      showToast('Ini adalah barang dari toko Anda sendiri.', 'error');
      setSelectedItemToBuy(null);
      return;
    }

    if (item.stock < qty) {
      showToast(`Stok tersisa hanya ${item.stock} unit.`, 'error');
      return;
    }

    setIsProcessingOrder(true);
    const totalPrice = item.price * qty;
    const priceRpStr = `Rp ${item.price.toLocaleString('id-ID')}`;
    const totalPriceStr = `Rp ${totalPrice.toLocaleString('id-ID')}`;
    const notesText = buyerNotes.trim() ? `\n📝 Catatan Pembeli: "${buyerNotes.trim()}"` : '';

    try {
      const newOrderRef = push(ref(db, 'shopOrders'));
      const orderId = newOrderRef.key!;
      const orderData: ShopOrder = {
        id: orderId,
        itemId: item.id,
        itemName: item.name,
        itemImage: item.imageURL,
        price: item.price,
        quantity: qty,
        totalPrice: totalPrice,
        buyerId: currentUser.id,
        buyerName: currentUser.name,
        buyerPhoto: currentUser.photoURL || '',
        sellerId: item.ownerId,
        shopId: item.shopId,
        shopName: item.ownerName,
        notes: buyerNotes.trim(),
        status: 'pending',
        timestamp: Date.now()
      };
      await set(newOrderRef, orderData);

      const updatedStock = Math.max(0, item.stock - qty);
      await update(ref(db, `shopItems/${item.id}`), { stock: updatedStock });

      const chatOrderMsg = `🛍️ INVOICE PEMESANAN BARANG (#${orderId.slice(-6).toUpperCase()})\n` +
        `----------------------------------------\n` +
        `📦 Produk: ${item.name}\n` +
        `🔢 Jumlah: ${qty} pcs\n` +
        `💰 Harga Satuan: ${priceRpStr}\n` +
        `🏷️ Total Pembayaran: ${totalPriceStr}` +
        notesText + `\n\n` +
        `Halo Penjual (${item.ownerName}), saya telah membuat pesanan untuk produk ini. Mohon konfirmasi ketersediaan & petunjuk pembayaran/pengirimannya. Terima kasih!`;

      const getChatId = (uid1: string, uid2: string) => [uid1, uid2].sort().join('_');
      const chatId = getChatId(currentUser.id, item.ownerId);

      const msgRef = push(ref(db, `chats/${chatId}/messages`));
      await set(msgRef, {
        senderId: currentUser.id,
        text: chatOrderMsg,
        timestamp: Date.now(),
        isShop: true,
        photoURL: item.imageURL || null
      });

      await update(ref(db, `chats/${chatId}`), {
        isShopChat: true,
        lastMessage: `🛍️ Pesanan Baru: ${item.name} (${totalPriceStr})`,
        lastUpdated: Date.now()
      });

      const notifRef = push(ref(db, `notifications/${item.ownerId}`));
      await set(notifRef, {
        id: notifRef.key,
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderPhoto: currentUser.photoURL || '',
        type: 'comment',
        commentText: `Pesanan Baru Masuk: "${item.name}" (${qty} pcs - ${totalPriceStr})`,
        timestamp: Date.now(),
        read: false
      });

      showToast(`Pesanan berhasil dibuat & dikirim ke chat ${item.ownerName}! 🚀`, 'success');
      setSelectedItemToBuy(null);
      setBuyerNotes('');
      setBuyQuantity(1);

      if (onNavigateToChat) {
        onNavigateToChat(item.ownerId, chatOrderMsg);
      }
    } catch (err) {
      console.error('Error processing order:', err);
      showToast('Gagal membuat pesanan.', 'error');
    } finally {
      setIsProcessingOrder(false);
    }
  };

  // Update Order Status
  const handleUpdateOrderStatus = async (orderId: string, newStatus: 'pending' | 'processing' | 'completed' | 'cancelled') => {
    try {
      await update(ref(db, `shopOrders/${orderId}`), { status: newStatus });
      const statusLabels: Record<string, string> = {
        processing: 'Diproses 📦',
        completed: 'Selesai / Terkirim ✅',
        cancelled: 'Dibatalkan ❌',
        pending: 'Menunggu 🟡'
      };
      showToast(`Status pesanan diperbarui menjadi: ${statusLabels[newStatus]}`, 'success');
    } catch (err) {
      console.error('Failed to update order status:', err);
      showToast('Gagal mengubah status pesanan.', 'error');
    }
  };

  // Filter items for Explore tab
  const filteredItems = useMemo(() => {
    let list = items.filter(item => {
      if (selectedShopFilter && item.shopId !== selectedShopFilter.id) return false;
      const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
      const q = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
                            item.name.toLowerCase().includes(q) ||
                            item.description.toLowerCase().includes(q) ||
                            item.ownerName.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });

    if (sortBy === 'price_asc') {
      list.sort((a, b) => a.price - b.price);
    } else if (sortBy === 'price_desc') {
      list.sort((a, b) => b.price - a.price);
    } else if (sortBy === 'name_asc') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    return list;
  }, [items, selectedShopFilter, categoryFilter, searchQuery, sortBy]);

  // Filter shops for Explore Shops sub-tab
  const filteredShops = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return shops.filter(shop => {
      return !searchQuery ||
             shop.shopName.toLowerCase().includes(q) ||
             shop.ownerName.toLowerCase().includes(q) ||
             (shop.description || '').toLowerCase().includes(q);
    });
  }, [shops, searchQuery]);

  const categories = [
    { id: 'all', name: 'Semua', icon: 'fa-layer-group' },
    { id: 'Fashion', name: 'Fashion', icon: 'fa-shirt' },
    { id: 'Digital', name: 'Digital', icon: 'fa-bolt' },
    { id: 'Aksesoris', name: 'Aksesoris', icon: 'fa-gem' },
    { id: 'Kuliner', name: 'Kuliner', icon: 'fa-utensils' },
    { id: 'Jasa', name: 'Jasa & Kreatif', icon: 'fa-wand-magic-sparkles' },
    { id: 'Elektronik', name: 'Elektronik', icon: 'fa-mobile-screen' },
    { id: 'Umum', name: 'Lainnya', icon: 'fa-box-archive' },
  ];

  const totalCatalogWorth = useMemo(() => {
    return myShopItems.reduce((acc, curr) => acc + (curr.price * (curr.stock || 1)), 0);
  }, [myShopItems]);

  return (
    <div className="min-h-screen bg-[#fafafa] pb-28 animate-fade-in text-neutral-900">
      {/* Toast Alert */}
      {notificationMsg && (
        <div className={`fixed top-16 left-1/2 -translate-x-1/2 z-[110] px-5 py-3 rounded-2xl shadow-2xl border flex items-center space-x-2 text-xs font-black transition-all animate-scale-up backdrop-blur-md ${
          notificationMsg.type === 'success' 
            ? 'bg-neutral-950 text-white border-amber-400/80 shadow-amber-400/10' 
            : notificationMsg.type === 'info'
            ? 'bg-neutral-900 text-white border-cyan-400/60'
            : 'bg-red-600 text-white border-red-700'
        }`}>
          <i className={`fas ${notificationMsg.type === 'success' ? 'fa-circle-check text-amber-400' : notificationMsg.type === 'info' ? 'fa-circle-info text-cyan-300' : 'fa-circle-exclamation'}`}></i>
          <span>{notificationMsg.text}</span>
        </div>
      )}

      {/* LUXURY HERO HEADER BANNER */}
      <div className="bg-gradient-to-br from-zinc-950 via-neutral-900 to-amber-950 text-white p-5 sm:p-6 shadow-2xl relative overflow-hidden border-b border-white/10">
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-amber-500/15 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-yellow-500/10 rounded-full blur-2xl pointer-events-none"></div>

        <div className="max-w-4xl mx-auto relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2">
                <span className="bg-gradient-to-r from-amber-400 to-yellow-500 text-black text-[9px] font-black uppercase px-3 py-1 rounded-full tracking-wider shadow-sm flex items-center space-x-1">
                  <i className="fas fa-shield-halved text-[8px]"></i>
                  <span>Verifikasi KYC Penjual Vimos</span>
                </span>
                {isVerifiedSeller && (
                  <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-500/40 flex items-center space-x-1">
                    <i className="fas fa-circle-check text-emerald-400 text-[9px]"></i>
                    <span>Toko Terverifikasi</span>
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight mt-2 uppercase text-white">
                Pasar & Jual Beli
              </h1>
              <p className="text-xs text-neutral-300 mt-1 max-w-md leading-relaxed">
                Jelajahi produk berkualitas dari merchant terverifikasi atau daftarkan akun toko resmi Anda dengan verifikasi KTP.
              </p>
            </div>

            {/* Quick stats counters */}
            <div className="flex items-center gap-2 self-start sm:self-center">
              <div className="bg-white/10 backdrop-blur-md border border-white/15 px-3 py-2 rounded-2xl text-center">
                <p className="text-xs sm:text-sm font-black text-amber-300">{items.length}</p>
                <p className="text-[8px] uppercase tracking-widest text-neutral-300 font-bold">Produk</p>
              </div>
              <div className="bg-white/10 backdrop-blur-md border border-white/15 px-3 py-2 rounded-2xl text-center">
                <p className="text-xs sm:text-sm font-black text-amber-300">{shops.length}</p>
                <p className="text-[8px] uppercase tracking-widest text-neutral-300 font-bold">Toko</p>
              </div>
              <div className="bg-white/10 backdrop-blur-md border border-white/15 px-3 py-2 rounded-2xl text-center">
                <p className="text-xs sm:text-sm font-black text-amber-300">{orders.length}</p>
                <p className="text-[8px] uppercase tracking-widest text-neutral-300 font-bold">Pesanan</p>
              </div>
            </div>
          </div>

          {/* MAIN TABS BAR */}
          <div className="flex border-b border-white/15 mt-6 space-x-6 text-xs font-bold relative z-10 overflow-x-auto scrollbar-none">
            <button
              onClick={() => setActiveTab('explore')}
              className={`pb-3 shrink-0 transition-all flex items-center space-x-2 relative cursor-pointer ${
                activeTab === 'explore' ? 'text-amber-400 font-black' : 'text-neutral-400 hover:text-white'
              }`}
            >
              <i className="fas fa-compass"></i>
              <span>Jelajahi Pasar</span>
              {activeTab === 'explore' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400 rounded-full shadow-lg shadow-amber-400"></div>}
            </button>

            <button
              onClick={() => setActiveTab('my_shop')}
              className={`pb-3 shrink-0 transition-all flex items-center space-x-2 relative cursor-pointer ${
                activeTab === 'my_shop' ? 'text-amber-400 font-black' : 'text-neutral-400 hover:text-white'
              }`}
            >
              <i className="fas fa-store"></i>
              <span>
                {isVerifiedSeller ? `Toko Saya (${myShop?.shopName || 'Aktif'})` : 'Daftar Akun Toko (KYC)'}
              </span>
              {!isVerifiedSeller && myApplication?.status === 'pending' && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
              )}
              {activeTab === 'my_shop' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400 rounded-full shadow-lg shadow-amber-400"></div>}
            </button>

            <button
              onClick={() => setActiveTab('orders')}
              className={`pb-3 shrink-0 transition-all flex items-center space-x-2 relative cursor-pointer ${
                activeTab === 'orders' ? 'text-amber-400 font-black' : 'text-neutral-400 hover:text-white'
              }`}
            >
              <i className="fas fa-receipt text-amber-400"></i>
              <span>Pesanan & Transaksi</span>
              {(incomingOrders.length > 0 || myPurchases.length > 0) && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              )}
              {activeTab === 'orders' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400 rounded-full shadow-lg shadow-amber-400"></div>}
            </button>
          </div>
        </div>
      </div>

      {/* CONTAINER */}
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-5 pb-28 sm:pb-32">
        {/* ============================================================= */}
        {/* TAB 1: EXPLORE / JELAJAHI PASAR */}
        {/* ============================================================= */}
        {activeTab === 'explore' && (
          <div className="space-y-4">
            {/* SUB-TABS: SEMUA PRODUK vs DAFTAR TOKO */}
            <div className="bg-white p-1 rounded-2xl border border-neutral-200/90 flex space-x-1 shadow-xs">
              <button
                onClick={() => {
                  setExploreSubTab('items');
                  setSelectedShopFilter(null);
                }}
                className={`flex-1 py-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center space-x-2 cursor-pointer ${
                  exploreSubTab === 'items' && !selectedShopFilter
                    ? 'bg-neutral-950 text-white shadow-md'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                <i className="fas fa-boxes-stacked"></i>
                <span>Semua Produk ({items.length})</span>
              </button>

              <button
                onClick={() => setExploreSubTab('shops')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center space-x-2 cursor-pointer ${
                  exploreSubTab === 'shops'
                    ? 'bg-neutral-950 text-white shadow-md'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                <i className="fas fa-shop"></i>
                <span>Direktori Toko ({shops.length})</span>
              </button>
            </div>

            {/* ACTIVE SHOP FILTER BANNER */}
            {selectedShopFilter && (
              <div className="bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-100 border border-amber-300 rounded-3xl p-3.5 flex items-center justify-between shadow-xs animate-fade-in">
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-amber-400 text-black flex items-center justify-center font-black shrink-0 shadow-sm">
                    <i className="fas fa-store"></i>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] text-amber-800 font-bold uppercase tracking-wider">Menampilkan Katalog Toko:</p>
                    <p className="text-sm font-black text-neutral-900 truncate">{selectedShopFilter.shopName}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedShopFilter(null)}
                  className="bg-neutral-900 hover:bg-black text-white px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider shadow-xs transition-transform active:scale-95 shrink-0"
                >
                  Lihat Semua
                </button>
              </div>
            )}

            {/* SEARCH & SORT BAR */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 text-xs"></i>
                <input
                  type="text"
                  placeholder={exploreSubTab === 'items' ? "Cari barang, pakaian, voucher, jasa..." : "Cari nama toko atau pemilik..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white border border-neutral-300 pl-9 pr-9 py-2.5 rounded-2xl text-xs font-bold focus:outline-none focus:border-black focus:ring-2 focus:ring-black/10 shadow-xs"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-black text-xs">
                    <i className="fas fa-xmark"></i>
                  </button>
                )}
              </div>

              {exploreSubTab === 'items' && (
                <div className="flex items-center space-x-2 shrink-0">
                  <select
                    value={sortBy}
                    onChange={(e: any) => setSortBy(e.target.value)}
                    className="bg-white border border-neutral-300 rounded-2xl px-3 py-2.5 text-xs font-bold text-neutral-700 focus:outline-none focus:border-black shadow-xs cursor-pointer"
                  >
                    <option value="newest">Terbaru</option>
                    <option value="price_asc">Harga Terendah</option>
                    <option value="price_desc">Harga Tertinggi</option>
                    <option value="name_asc">Nama (A-Z)</option>
                  </select>
                </div>
              )}
            </div>

            {/* CATEGORY PILLS */}
            {exploreSubTab === 'items' && (
              <div className="flex space-x-2 overflow-x-auto pb-1 scrollbar-none">
                {categories.map(cat => {
                  const isSelected = categoryFilter === cat.id;
                  const count = cat.id === 'all' 
                    ? items.length 
                    : items.filter(i => i.category === cat.id).length;

                  return (
                    <button
                      key={cat.id}
                      onClick={() => setCategoryFilter(cat.id)}
                      className={`px-3.5 py-2 rounded-2xl text-xs font-bold shrink-0 transition-all flex items-center space-x-1.5 cursor-pointer select-none ${
                        isSelected
                          ? 'bg-neutral-950 text-white shadow-md shadow-black/10 scale-105'
                          : 'bg-white text-neutral-700 border border-neutral-200/90 hover:bg-neutral-100 hover:border-neutral-300'
                      }`}
                    >
                      <i className={`fas ${cat.icon} text-[10px] ${isSelected ? 'text-amber-400' : 'text-neutral-400'}`}></i>
                      <span>{cat.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-500'
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* PRODUCT GRID */}
            {exploreSubTab === 'items' && (
              <div>
                {loadingData ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4 animate-pulse">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <div key={i} className="bg-white rounded-3xl overflow-hidden border border-neutral-200/80 p-3 flex flex-col space-y-3 shadow-xs">
                        <div className="aspect-square bg-neutral-100 rounded-2xl w-full"></div>
                        <div className="space-y-1.5 px-0.5">
                          <div className="h-3 bg-neutral-100 rounded-md w-3/4"></div>
                          <div className="h-2.5 bg-neutral-100 rounded-md w-1/2"></div>
                        </div>
                        <div className="h-4 bg-neutral-200 rounded-lg w-2/3 mt-2"></div>
                      </div>
                    ))}
                  </div>
                ) : filteredItems.length === 0 ? (
                  <div className="bg-white rounded-3xl border border-neutral-200 p-10 text-center space-y-3 my-4 shadow-xs">
                    <div className="w-16 h-16 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center text-2xl mx-auto shadow-inner">
                      <i className="fas fa-box-open"></i>
                    </div>
                    <h3 className="font-black text-sm text-neutral-900 uppercase">Tidak Ada Produk Ditemukan</h3>
                    <p className="text-xs text-neutral-500 max-w-xs mx-auto leading-relaxed">
                      {searchQuery ? `Tidak ada barang yang cocok dengan "${searchQuery}".` : 'Belum ada produk yang dipajang pada kategori ini.'}
                    </p>
                    {!isVerifiedSeller && (
                      <button
                        onClick={() => {
                          setActiveTab('my_shop');
                          setIsFillingKYC(true);
                        }}
                        className="bg-black text-white text-xs font-bold px-5 py-2.5 rounded-full shadow-md hover:bg-neutral-800 transition-all cursor-pointer"
                      >
                        Daftar Akun Toko & Mulai Jual
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                    {filteredItems.map(item => {
                      const isMyOwnItem = item.ownerId === currentUser.id;
                      const isOutOfStock = (item.stock || 0) <= 0;

                      return (
                        <div
                          key={item.id}
                          className="bg-white border border-neutral-200/90 rounded-3xl overflow-hidden flex flex-col justify-between shadow-xs hover:shadow-xl hover:border-black/30 transition-all group duration-300"
                        >
                          <div className="relative aspect-square bg-neutral-100 overflow-hidden cursor-pointer" onClick={() => setSelectedItemToBuy(item)}>
                            <img
                              src={item.imageURL}
                              alt={item.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                              loading="lazy"
                              onError={(e) => {
                                (e.target as HTMLElement).setAttribute('src', 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80');
                              }}
                            />
                            <span className="absolute top-2 left-2 bg-black/75 backdrop-blur-md text-white text-[9px] font-black px-2 py-0.5 rounded-full capitalize shadow-xs">
                              {item.category || 'Umum'}
                            </span>

                            <span className={`absolute top-2 right-2 text-[9px] font-black px-2 py-0.5 rounded-full shadow-xs backdrop-blur-md ${
                              isOutOfStock 
                                ? 'bg-red-600/90 text-white' 
                                : (item.stock <= 3 ? 'bg-amber-500/90 text-white' : 'bg-emerald-600/90 text-white')
                            }`}>
                              {isOutOfStock ? 'Habis' : `Stok: ${item.stock}`}
                            </span>

                            {isOutOfStock && (
                              <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center">
                                <span className="bg-red-600 text-white font-black text-xs uppercase px-3 py-1 rounded-full shadow-md">
                                  Stok Habis
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="p-3.5 flex-1 flex flex-col justify-between space-y-2">
                            <div>
                              <div className="flex items-center space-x-1 text-[10px] text-neutral-400 font-semibold mb-1 truncate">
                                <i className="fas fa-store text-amber-500 text-[8px]"></i>
                                <span className="truncate">{item.ownerName}</span>
                              </div>
                              <h3 
                                onClick={() => setSelectedItemToBuy(item)}
                                className="font-black text-xs sm:text-sm text-neutral-900 line-clamp-1 cursor-pointer hover:underline"
                              >
                                {item.name}
                              </h3>
                              <p className="text-[10px] text-neutral-500 line-clamp-2 mt-0.5 leading-tight">
                                {item.description}
                              </p>
                            </div>

                            <div className="pt-2 border-t border-neutral-100 flex items-center justify-between gap-1">
                              <div>
                                <span className="text-[8px] text-neutral-400 block font-bold uppercase tracking-wider">Harga</span>
                                <span className="font-black text-xs sm:text-sm text-neutral-900 tracking-tight">
                                  Rp {item.price.toLocaleString('id-ID')}
                                </span>
                              </div>

                              {isMyOwnItem ? (
                                <div className="flex items-center space-x-1 shrink-0">
                                  <button
                                    onClick={() => handleEditItemClick(item)}
                                    className="bg-neutral-100 hover:bg-black hover:text-white text-neutral-700 px-2 py-1.5 rounded-xl text-[9px] font-black uppercase transition-all shadow-xs cursor-pointer"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleDeleteItem(item.id, item.name)}
                                    className="bg-red-50 hover:bg-red-600 text-red-600 hover:text-white p-1.5 rounded-xl text-[9px] font-black transition-all shadow-xs cursor-pointer flex items-center space-x-1"
                                    title="Hapus Produk"
                                  >
                                    <i className="fas fa-trash-can text-[9px]"></i>
                                  </button>
                                </div>
                              ) : currentUser.isAdmin ? (
                                <div className="flex items-center space-x-1 shrink-0">
                                  <button
                                    onClick={() => setSelectedItemToBuy(item)}
                                    disabled={isOutOfStock}
                                    className="bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-500 hover:to-yellow-600 disabled:from-neutral-200 disabled:to-neutral-300 text-black px-2.5 py-1.5 rounded-xl text-[9px] font-black uppercase shadow-xs transition-all active:scale-95 flex items-center space-x-1 cursor-pointer"
                                  >
                                    <i className="fas fa-bag-shopping text-[9px]"></i>
                                    <span>Beli</span>
                                  </button>
                                  <button
                                    onClick={() => handleDeleteItem(item.id, item.name)}
                                    className="bg-red-50 hover:bg-red-600 text-red-600 hover:text-white p-1.5 rounded-xl text-[9px] font-black transition-all shadow-xs cursor-pointer flex items-center space-x-1"
                                    title="Hapus Produk (Admin)"
                                  >
                                    <i className="fas fa-trash-can text-[9px]"></i>
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setSelectedItemToBuy(item)}
                                  disabled={isOutOfStock}
                                  className="bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-500 hover:to-yellow-600 disabled:from-neutral-200 disabled:to-neutral-300 disabled:text-neutral-400 text-black px-3 py-1.5 rounded-xl text-[10px] font-black uppercase shadow-xs transition-all active:scale-95 flex items-center space-x-1 cursor-pointer"
                                >
                                  <i className="fas fa-bag-shopping text-[9px]"></i>
                                  <span>Beli</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* SHOPS DIRECTORY */}
            {exploreSubTab === 'shops' && (
              <div>
                {filteredShops.length === 0 ? (
                  <div className="bg-white rounded-3xl border border-neutral-200 p-10 text-center space-y-3 shadow-xs">
                    <div className="w-16 h-16 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-400 text-2xl mx-auto">
                      <i className="fas fa-store-slash"></i>
                    </div>
                    <h3 className="font-black text-sm text-neutral-900 uppercase">Belum Ada Toko Terdaftar</h3>
                    <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                      Jadilah merchant pertama yang membuka toko terverifikasi di Vimos!
                    </p>
                    {!isVerifiedSeller && (
                      <button
                        onClick={() => {
                          setActiveTab('my_shop');
                          setIsFillingKYC(true);
                        }}
                        className="bg-black text-white text-xs font-bold px-5 py-2.5 rounded-full shadow-md hover:bg-neutral-800 transition-all cursor-pointer"
                      >
                        Ajukan Pendaftaran Toko
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {filteredShops.map(shop => {
                      const shopItemCount = items.filter(i => i.shopId === shop.id).length;
                      const isMyOwnShop = shop.ownerId === currentUser.id;

                      return (
                        <div
                          key={shop.id}
                          className="bg-white border border-neutral-200/90 rounded-3xl overflow-hidden shadow-xs hover:shadow-lg transition-all flex flex-col justify-between group"
                        >
                          <div className="h-32 bg-neutral-900 relative overflow-hidden">
                            <img
                              src={shop.bannerURL}
                              alt={shop.shopName}
                              className="w-full h-full object-cover opacity-85 group-hover:scale-105 transition-transform duration-500"
                              onError={(e) => {
                                (e.target as HTMLElement).setAttribute('src', 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&auto=format&fit=crop&q=80');
                              }}
                            />
                            <div className="absolute top-2.5 right-2.5 flex items-center space-x-1.5">
                              <span className="bg-black/70 backdrop-blur-md text-white text-[9px] font-black px-2.5 py-1 rounded-full flex items-center space-x-1 shadow-sm">
                                <i className="fas fa-box text-amber-400"></i>
                                <span>{shopItemCount} Produk</span>
                              </span>

                              {(isMyOwnShop || currentUser.isAdmin) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteShop(shop.id, shop.shopName, shop.ownerId);
                                  }}
                                  className="bg-red-600/90 hover:bg-red-600 text-white text-[9px] font-black px-2.5 py-1 rounded-full backdrop-blur-md transition-all shadow-sm flex items-center space-x-1 cursor-pointer"
                                  title="Hapus Toko ini"
                                >
                                  <i className="fas fa-trash-can text-[9px]"></i>
                                  <span>Hapus</span>
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                            <div>
                              <div className="flex items-center space-x-2">
                                <h3 className="font-black text-base text-neutral-900">{shop.shopName}</h3>
                                {shop.isVerified && (
                                  <span className="text-blue-500 text-xs" title="Toko Resmi Terverifikasi">
                                    <i className="fas fa-circle-check"></i>
                                  </span>
                                )}
                                {isMyOwnShop && (
                                  <span className="bg-amber-400 text-black text-[8px] font-black uppercase px-2 py-0.5 rounded-full">
                                    Toko Anda
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-neutral-500 mt-1 line-clamp-2">
                                {shop.description || 'Toko resmi terverifikasi di Vimos.'}
                              </p>
                              <p className="text-[10px] text-neutral-400 font-semibold mt-2 flex items-center space-x-1.5">
                                <i className="fas fa-circle-user text-neutral-500"></i>
                                <span>Pemilik: <strong className="text-neutral-700">{shop.ownerName}</strong></span>
                              </p>
                            </div>

                            <button
                              onClick={() => {
                                setSelectedShopFilter(shop);
                                setExploreSubTab('items');
                              }}
                              className="w-full bg-neutral-950 hover:bg-black text-white py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center space-x-2 shadow-md active:scale-95 cursor-pointer"
                            >
                              <i className="fas fa-eye text-xs text-amber-400"></i>
                              <span>Lihat Katalog Toko ({shopItemCount})</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 2: MY SHOP / PENGAJUAN KYC & KELOLA TOKO */}
        {/* ============================================================= */}
        {activeTab === 'my_shop' && (
          <div className="space-y-5">
            {/* CASE 1: USER IS NOT VERIFIED SELLER YET */}
            {!isVerifiedSeller ? (
              <div>
                {/* CASE 1A: APPLICATION IS CURRENTLY PENDING */}
                {myApplication?.status === 'pending' && !isFillingKYC ? (
                  <div className="bg-white rounded-3xl border-2 border-amber-400 p-6 sm:p-8 shadow-lg text-center space-y-5 animate-fade-in">
                    <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center text-3xl mx-auto shadow-inner animate-pulse">
                      <i className="fas fa-hourglass-half"></i>
                    </div>

                    <div className="max-w-md mx-auto space-y-2">
                      <span className="bg-amber-400 text-black text-[10px] font-black uppercase px-3 py-1 rounded-full tracking-wider shadow-xs">
                        Status: Menunggu Review Admin
                      </span>
                      <h2 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight">
                        Pengajuan Akun Toko Sedang Ditinjau Admin
                      </h2>
                      <p className="text-xs text-neutral-600 leading-relaxed">
                        Foto profil, nomor WhatsApp, dan lokasi tempat tinggal Anda telah berhasil dikirimkan ke Tim Admin Vimos secara aman & privat. Admin akan meninjau pengajuan Anda sebelum toko diaktifkan.
                      </p>
                    </div>

                    {/* Summary of submitted details */}
                    <div className="max-w-md mx-auto bg-neutral-50 border border-neutral-200 rounded-2xl p-4 text-xs text-left space-y-2 select-none">
                      <div className="flex justify-between items-center border-b border-neutral-200 pb-1.5">
                        <span className="text-neutral-500 font-bold">Foto Pengguna / Toko:</span>
                        <img 
                          src={myApplication.ownerPhotoURL || myApplication.userPhoto || currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(currentUser.name || 'User')}`} 
                          alt="Foto Pengguna" 
                          className="w-8 h-8 rounded-full object-cover border border-neutral-300"
                        />
                      </div>
                      <div className="flex justify-between border-b border-neutral-200 pb-1.5">
                        <span className="text-neutral-500 font-bold">Nama Toko Diajukan:</span>
                        <span className="font-black text-neutral-900">{myApplication.shopName}</span>
                      </div>
                      <div className="flex justify-between border-b border-neutral-200 pb-1.5">
                        <span className="text-neutral-500 font-bold">Nama Lengkap Pemilik:</span>
                        <span className="font-bold text-neutral-900">{myApplication.fullName}</span>
                      </div>
                      <div className="flex justify-between border-b border-neutral-200 pb-1.5">
                        <span className="text-neutral-500 font-bold">Nomor WhatsApp:</span>
                        <span className="font-bold text-neutral-900">{myApplication.phoneWhatsapp}</span>
                      </div>
                      <div className="flex justify-between border-b border-neutral-200 pb-1.5">
                        <span className="text-neutral-500 font-bold">Lokasi Tempat Tinggal:</span>
                        <span className="font-bold text-neutral-900">{myApplication.city}, {myApplication.province}</span>
                      </div>
                      <div className="flex justify-between pt-0.5 text-[11px]">
                        <span className="text-neutral-500">Waktu Pengajuan:</span>
                        <span className="font-medium text-neutral-700">
                          {new Date(myApplication.submittedAt).toLocaleString('id-ID')}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 max-w-md mx-auto space-y-3">
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center space-x-2 text-emerald-900 text-[11px] text-left">
                        <i className="fas fa-shield-halved text-emerald-600 text-base shrink-0"></i>
                        <span>🔒 <strong>Anti-Pencurian Data:</strong> Data kontak dan alamat Anda dienkripsi dan diisolasi khusus untuk Admin. Tidak ada dokumen KTP/NIK yang disimpan.</span>
                      </div>

                      <button
                        onClick={() => {
                          setKycFullName(myApplication.fullName || currentUser.name || '');
                          setKycOwnerPhoto(myApplication.ownerPhotoURL || currentUser.photoURL || '');
                          setKycPhoneWA(myApplication.phoneWhatsapp || '');
                          setKycAddress(myApplication.address || '');
                          setKycCity(myApplication.city || '');
                          setKycProvince(myApplication.province || 'DKI Jakarta');
                          setKycShopName(myApplication.shopName || '');
                          setKycShopDesc(myApplication.shopDescription || '');
                          setIsFillingKYC(true);
                        }}
                        className="w-full py-3 bg-neutral-900 hover:bg-black text-white text-xs font-black uppercase rounded-2xl shadow-md transition-all active:scale-95 flex items-center justify-center space-x-2 cursor-pointer"
                      >
                        <i className="fas fa-pen-to-square text-amber-400"></i>
                        <span>Edit / Perbarui Data Pengajuan</span>
                      </button>
                    </div>
                  </div>
                ) : myApplication?.status === 'rejected' && !isFillingKYC ? (
                  /* CASE 1B: APPLICATION WAS REJECTED BY ADMIN */
                  <div className="bg-white rounded-3xl border-2 border-red-300 p-6 sm:p-8 shadow-lg text-center space-y-5 animate-fade-in">
                    <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center text-3xl mx-auto shadow-inner">
                      <i className="fas fa-circle-xmark"></i>
                    </div>

                    <div className="max-w-md mx-auto space-y-2">
                      <span className="bg-red-600 text-white text-[10px] font-black uppercase px-3 py-1 rounded-full tracking-wider shadow-xs">
                        Pengajuan Belum Disetujui
                      </span>
                      <h2 className="text-xl font-black text-neutral-900 tracking-tight">
                        Pengajuan Akun Toko Ditolak
                      </h2>
                      <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-left text-xs space-y-1">
                        <span className="text-[10px] font-black uppercase text-red-800 block">Alasan / Catatan Admin:</span>
                        <p className="text-neutral-800 font-medium">{myApplication.rejectionReason || 'Data nomor telepon atau lokasi tidak valid.'}</p>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setKycFullName(myApplication.fullName || currentUser.name || '');
                        setKycOwnerPhoto(myApplication.ownerPhotoURL || currentUser.photoURL || '');
                        setKycPhoneWA(myApplication.phoneWhatsapp || '');
                        setKycAddress(myApplication.address || '');
                        setKycCity(myApplication.city || '');
                        setKycProvince(myApplication.province || 'DKI Jakarta');
                        setKycShopName(myApplication.shopName || '');
                        setKycShopDesc(myApplication.shopDescription || '');
                        setIsFillingKYC(true);
                      }}
                      className="px-6 py-3 bg-neutral-950 hover:bg-black text-white text-xs font-black uppercase rounded-2xl shadow-md transition-all active:scale-95 cursor-pointer"
                    >
                      Perbaiki Data & Ajukan Ulang
                    </button>
                  </div>
                ) : (
                  /* CASE 1C: REGISTRATION KYC FORM */
                  <div className="bg-white rounded-3xl border border-neutral-200 p-5 sm:p-7 shadow-sm space-y-5 animate-fade-in">
                    <div className="border-b border-neutral-100 pb-4">
                      <div className="flex items-center space-x-2">
                        <span className="bg-amber-400 text-black text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full">
                          Verifikasi Penjual Resmi
                        </span>
                        <span className="bg-emerald-100 text-emerald-800 text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1">
                          <i className="fas fa-lock text-[8px]"></i>
                          <span>Tanpa KTP / Privasi Aman</span>
                        </span>
                      </div>
                      <h2 className="font-black text-lg sm:text-xl text-neutral-900 uppercase mt-1">
                        Formulir Pendaftaran & Pengajuan Akun Toko
                      </h2>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        Untuk mencegah penipuan serta menjaga keamanan ekosistem Vimos, calon pedagang cukup melengkapi nomor WhatsApp aktif, lokasi tempat tinggal, dan foto profil untuk ditinjau oleh Admin.
                      </p>
                    </div>

                    <form onSubmit={handleSubmitKYCApplication} className="space-y-5">
                      {/* SECTION 1: DATA IDENTITAS & TEMPAT TINGGAL */}
                      <div className="space-y-3">
                        <h3 className="text-xs font-black uppercase tracking-wider text-amber-700 flex items-center space-x-1.5 border-b border-neutral-200 pb-1.5">
                          <i className="fas fa-user-check"></i>
                          <span>1. Data Pemilik & Lokasi Tempat Tinggal</span>
                        </h3>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                              Nama Lengkap Pemilik <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              required
                              placeholder="Nama lengkap Anda..."
                              value={kycFullName}
                              onChange={(e) => setKycFullName(e.target.value)}
                              className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-bold focus:outline-none focus:border-black focus:bg-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                              Nomor HP / WhatsApp Aktif <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="tel"
                              required
                              placeholder="Contoh: 081234567890"
                              value={kycPhoneWA}
                              onChange={(e) => setKycPhoneWA(e.target.value)}
                              className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-bold focus:outline-none focus:border-black focus:bg-white"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                                Provinsi <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="text"
                                required
                                placeholder="Provinsi..."
                                value={kycProvince}
                                onChange={(e) => setKycProvince(e.target.value)}
                                className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-bold focus:outline-none focus:border-black focus:bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                                Kota / Kab <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="text"
                                required
                                placeholder="Kota..."
                                value={kycCity}
                                onChange={(e) => setKycCity(e.target.value)}
                                className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-bold focus:outline-none focus:border-black focus:bg-white"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                              Alamat Lengkap Domisili <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              required
                              placeholder="Jl. Nama Jalan, No. Rumah, RT/RW, Kelurahan..."
                              value={kycAddress}
                              onChange={(e) => setKycAddress(e.target.value)}
                              className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-medium focus:outline-none focus:border-black focus:bg-white"
                            />
                          </div>
                        </div>
                      </div>

                      {/* SECTION 2: FOTO PENGGUNA / PEMILIK TOKO */}
                      <div className="space-y-3">
                        <h3 className="text-xs font-black uppercase tracking-wider text-amber-700 flex items-center space-x-1.5 border-b border-neutral-200 pb-1.5">
                          <i className="fas fa-camera"></i>
                          <span>2. Foto Pengguna / Pemilik Toko</span>
                        </h3>

                        <div className="p-3.5 bg-neutral-50 border border-neutral-200 rounded-2xl space-y-3">
                          <div className="flex flex-col sm:flex-row items-center gap-3.5">
                            <div className="w-20 h-20 rounded-2xl overflow-hidden bg-neutral-900 border-2 border-neutral-300 relative shadow-sm shrink-0">
                              <img 
                                src={kycOwnerPhoto || currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${currentUser.name}`} 
                                alt="Preview Foto Pengguna" 
                                className="w-full h-full object-cover" 
                              />
                            </div>

                            <div className="flex-1 space-y-2 text-center sm:text-left">
                              <p className="text-xs font-bold text-neutral-900">
                                Gunakan foto wajah / profil asli Anda yang jelas
                              </p>
                              <p className="text-[10px] text-neutral-500">
                                Foto ini digunakan untuk mengidentifikasi kepemilikan toko secara sah dan mencegah akun ganda/palsu.
                              </p>

                              {isCompressingOwnerPhoto && (
                                <div className="text-[10px] text-amber-700 font-bold animate-pulse flex items-center justify-center sm:justify-start space-x-1">
                                  <i className="fas fa-spinner fa-spin"></i>
                                  <span>Memproses foto pengguna...</span>
                                </div>
                              )}

                              <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                                <label className="border border-neutral-300 bg-white hover:border-black rounded-xl px-3 py-1.5 flex items-center space-x-1.5 cursor-pointer text-xs font-bold text-neutral-800 transition-all shadow-xs">
                                  <i className="fas fa-upload text-amber-500"></i>
                                  <span>Upload Foto Baru</span>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => handleFileUpload(e, setIsCompressingOwnerPhoto, (url) => setKycOwnerPhoto(url))}
                                  />
                                </label>

                                {currentUser.photoURL && kycOwnerPhoto !== currentUser.photoURL && (
                                  <button
                                    type="button"
                                    onClick={() => setKycOwnerPhoto(currentUser.photoURL || '')}
                                    className="border border-neutral-200 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl px-3 py-1.5 text-xs font-bold"
                                  >
                                    Pakai Foto Profil Saya
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* SECTION 3: RENCANA TOKO */}
                      <div className="space-y-3">
                        <h3 className="text-xs font-black uppercase tracking-wider text-amber-700 flex items-center space-x-1.5 border-b border-neutral-200 pb-1.5">
                          <i className="fas fa-store"></i>
                          <span>3. Rencana Informasi Toko Anda</span>
                        </h3>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                              Nama Toko yang Diinginkan <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              required
                              placeholder="Misal: Toko Berkah Nusantara, Galeri Merch..."
                              value={kycShopName}
                              onChange={(e) => setKycShopName(e.target.value)}
                              className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-bold focus:outline-none focus:border-black focus:bg-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                              Kategori Utama Barang <span className="text-red-500">*</span>
                            </label>
                            <select
                              value={kycShopCategory}
                              onChange={(e) => setKycShopCategory(e.target.value)}
                              className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-bold focus:outline-none focus:border-black focus:bg-white cursor-pointer"
                            >
                              {categories.filter(c => c.id !== 'all').map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                            Deskripsi Singkat Toko <span className="text-red-500">*</span>
                          </label>
                          <textarea
                            rows={2}
                            required
                            placeholder="Jelaskan produk apa yang akan Anda jual di toko ini..."
                            value={kycShopDesc}
                            onChange={(e) => setKycShopDesc(e.target.value)}
                            className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-medium focus:outline-none focus:border-black focus:bg-white resize-none"
                          />
                        </div>
                      </div>

                      {/* Anti-Theft & Privacy Statement */}
                      <div className="p-3.5 bg-neutral-900 text-white rounded-2xl flex items-center space-x-3 border border-neutral-800">
                        <i className="fas fa-shield-halved text-amber-400 text-xl shrink-0"></i>
                        <p className="text-[11px] leading-snug text-neutral-300">
                          <strong className="text-white font-bold">🔒 Sistem Anti-Pencurian Data:</strong> Tanpa KTP/NIK. Data nomor kontak dan alamat tempat tinggal Anda hanya dapat diakses oleh Admin untuk verifikasi keamanan pedagang, dan tidak akan pernah dibagikan kepada publik/pembeli umum.
                        </p>
                      </div>

                      <button
                        type="submit"
                        disabled={isSubmittingKYC}
                        className="w-full py-4 bg-neutral-950 hover:bg-black disabled:opacity-50 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-xl transition-all active:scale-95 flex items-center justify-center space-x-2 cursor-pointer"
                      >
                        {isSubmittingKYC ? (
                          <>
                            <i className="fas fa-spinner fa-spin text-sm"></i>
                            <span>Mengirim Pengajuan ke Admin...</span>
                          </>
                        ) : (
                          <>
                            <i className="fas fa-paper-plane text-xs text-amber-400"></i>
                            <span>Kirim Pengajuan Akun Toko ke Admin</span>
                          </>
                        )}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            ) : (
              /* CASE 2: USER IS AN APPROVED MERCHANT -> SHOW FULL DASHBOARD */
              <div className="space-y-5">
                {/* SHOP BANNER CARD */}
                <div className="bg-white border border-neutral-200/90 rounded-3xl overflow-hidden shadow-xs">
                  <div className="h-36 sm:h-44 bg-neutral-900 relative">
                    <img
                      src={myShop?.bannerURL || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&auto=format&fit=crop&q=80'}
                      alt={myShop?.shopName}
                      className="w-full h-full object-cover opacity-90"
                    />
                    <div className="absolute top-3 right-3 flex items-center space-x-2">
                      <button
                        onClick={() => setIsEditingShop(true)}
                        className="bg-black/75 hover:bg-black text-white text-[10px] font-black px-3.5 py-1.5 rounded-xl backdrop-blur-md transition-all flex items-center space-x-1.5 shadow-md cursor-pointer"
                      >
                        <i className="fas fa-pencil"></i>
                        <span>Edit Toko</span>
                      </button>
                      <button
                        onClick={() => myShop && handleDeleteShop(myShop.id, myShop.shopName, myShop.ownerId)}
                        className="bg-red-600/85 hover:bg-red-600 text-white text-[10px] font-black px-3 py-1.5 rounded-xl backdrop-blur-md transition-all flex items-center space-x-1.5 shadow-md cursor-pointer"
                        title="Hapus Toko Saya Secara Permanen"
                      >
                        <i className="fas fa-trash-can"></i>
                        <span>Hapus Toko</span>
                      </button>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-neutral-100">
                    <div>
                      <div className="flex items-center space-x-2">
                        <h2 className="font-black text-lg sm:text-xl text-neutral-900">
                          {myShop?.shopName}
                        </h2>
                        <span className="bg-emerald-500 text-white text-[8px] font-black uppercase px-2 py-0.5 rounded-full flex items-center space-x-1 shadow-xs">
                          <i className="fas fa-check"></i>
                          <span>Terverifikasi KYC</span>
                        </span>
                      </div>
                      <p className="text-xs text-neutral-500 mt-1 max-w-lg">{myShop?.description}</p>
                    </div>

                    <button
                      onClick={() => {
                        setEditingItemId(null);
                        setItemName('');
                        setItemPrice('');
                        setItemDesc('');
                        setItemCategory('Fashion');
                        setItemImage('');
                        setItemStock('10');
                        setIsAddingItem(true);
                      }}
                      className="bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-500 hover:to-yellow-600 text-black text-xs font-black px-4 py-2.5 rounded-2xl uppercase shadow-md transition-all active:scale-95 flex items-center justify-center space-x-2 shrink-0 cursor-pointer"
                    >
                      <i className="fas fa-plus"></i>
                      <span>Tambah Produk Baru</span>
                    </button>
                  </div>

                  {/* METRICS ROW */}
                  <div className="grid grid-cols-3 divide-x divide-neutral-100 bg-neutral-50/50 p-3 text-center text-xs">
                    <div>
                      <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Total Produk</p>
                      <p className="text-sm sm:text-base font-black text-neutral-900 mt-0.5">{myShopItems.length}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Nilai Katalog</p>
                      <p className="text-sm sm:text-base font-black text-neutral-900 mt-0.5">
                        Rp {totalCatalogWorth.toLocaleString('id-ID')}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Pesanan Masuk</p>
                      <p className="text-sm sm:text-base font-black text-amber-600 mt-0.5">{incomingOrders.length}</p>
                    </div>
                  </div>
                </div>

                {/* EDIT SHOP PROFILE MODAL */}
                {isEditingShop && (
                  <div className="bg-white rounded-3xl border-2 border-black p-5 shadow-xl space-y-4 animate-scale-up">
                    <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                      <h3 className="font-black text-sm uppercase text-neutral-900">Edit Profil Toko</h3>
                      <button onClick={() => setIsEditingShop(false)} className="text-neutral-400 hover:text-black">
                        <i className="fas fa-xmark text-base"></i>
                      </button>
                    </div>

                    <form onSubmit={handleSaveShopInfo} className="space-y-3.5">
                      <div>
                        <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                          Nama Toko <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={shopNameInput}
                          onChange={(e) => setShopNameInput(e.target.value)}
                          className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-bold focus:outline-none focus:border-black"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                          Deskripsi Toko
                        </label>
                        <textarea
                          rows={2}
                          value={shopDescInput}
                          onChange={(e) => setShopDescInput(e.target.value)}
                          className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-medium focus:outline-none focus:border-black resize-none"
                        />
                      </div>

                      <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-2xl space-y-2">
                        <label className="text-[10px] font-black uppercase text-neutral-900 block">
                          Banner Toko
                        </label>
                        {shopBannerInput && (
                          <div className="h-24 rounded-xl overflow-hidden bg-neutral-900 relative">
                            <img src={shopBannerInput} alt="Banner" className="w-full h-full object-cover" />
                          </div>
                        )}
                        <label className="w-full border-2 border-dashed border-neutral-300 bg-white hover:border-black rounded-xl p-2 flex items-center justify-center space-x-2 cursor-pointer text-xs font-bold text-neutral-700">
                          <i className="fas fa-cloud-arrow-up text-amber-500"></i>
                          <span>Upload Banner Baru</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleFileUpload(e, setIsCompressingBanner, (url) => setShopBannerInput(url))}
                          />
                        </label>
                      </div>

                      <div className="flex space-x-2">
                        <button
                          type="button"
                          onClick={() => setIsEditingShop(false)}
                          className="flex-1 py-2.5 rounded-2xl border border-neutral-300 text-xs font-bold hover:bg-neutral-100"
                        >
                          Batal
                        </button>
                        <button
                          type="submit"
                          className="flex-1 bg-neutral-950 hover:bg-black text-white py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider"
                        >
                          Simpan Perubahan
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* FORM ADD / EDIT PRODUCT */}
                {isAddingItem && (
                  <div className="bg-white rounded-3xl border-2 border-black p-5 shadow-xl space-y-4 animate-scale-up">
                    <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                      <h3 className="font-black text-sm uppercase text-neutral-900 flex items-center space-x-2">
                        <i className="fas fa-box text-amber-500"></i>
                        <span>{editingItemId ? 'Edit Produk Toko' : 'Tambah Produk Baru ke Etalase'}</span>
                      </h3>
                      <button onClick={() => setIsAddingItem(false)} className="text-neutral-400 hover:text-black">
                        <i className="fas fa-xmark text-base"></i>
                      </button>
                    </div>

                    <form onSubmit={handleSaveItem} className="space-y-3.5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                            Nama Produk <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="Misal: Sepatu Sneaker Original, Kaos Distro..."
                            value={itemName}
                            onChange={(e) => setItemName(e.target.value)}
                            className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-bold focus:outline-none focus:border-black focus:bg-white"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                            Harga Barang (Rp) <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            required
                            min="100"
                            placeholder="Misal: 75000"
                            value={itemPrice}
                            onChange={(e) => setItemPrice(e.target.value)}
                            className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-bold focus:outline-none focus:border-black focus:bg-white"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                            Kategori Produk
                          </label>
                          <select
                            value={itemCategory}
                            onChange={(e) => setItemCategory(e.target.value)}
                            className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-bold focus:outline-none focus:border-black focus:bg-white cursor-pointer"
                          >
                            {categories.filter(c => c.id !== 'all').map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                            Jumlah Stok Tersedia
                          </label>
                          <input
                            type="number"
                            min="1"
                            placeholder="10"
                            value={itemStock}
                            onChange={(e) => setItemStock(e.target.value)}
                            className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-bold focus:outline-none focus:border-black focus:bg-white"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black uppercase text-neutral-700 mb-1">
                          Deskripsi Produk & Spesifikasi
                        </label>
                        <textarea
                          rows={2}
                          placeholder="Jelaskan ukuran, bahan, kondisi, dan kelengkapan produk..."
                          value={itemDesc}
                          onChange={(e) => setItemDesc(e.target.value)}
                          className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-2.5 text-xs font-medium focus:outline-none focus:border-black focus:bg-white resize-none"
                        />
                      </div>

                      {/* PHOTO UPLOAD WITH COMPRESSION */}
                      <div className="p-3.5 bg-neutral-50 border border-neutral-200 rounded-2xl space-y-2">
                        <label className="text-[10px] font-black uppercase text-neutral-900 block">
                          Foto Produk
                        </label>

                        {itemImage && (
                          <div className="w-24 h-24 rounded-2xl overflow-hidden bg-white border border-neutral-300 relative shadow-sm">
                            <img src={itemImage} alt="Product Preview" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setItemImage('')}
                              className="absolute top-1.5 right-1.5 bg-black/80 hover:bg-red-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs transition-colors"
                            >
                              <i className="fas fa-xmark"></i>
                            </button>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label className="w-full border-2 border-dashed border-neutral-300 bg-white hover:border-black rounded-2xl p-2.5 flex items-center justify-center space-x-2 cursor-pointer text-xs font-bold text-neutral-700 transition-all">
                            <i className="fas fa-cloud-arrow-up text-amber-500 text-sm"></i>
                            <span>Upload Foto</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handleFileUpload(e, setIsCompressingItemPhoto, (url) => setItemImage(url))}
                            />
                          </label>

                          <input
                            type="url"
                            placeholder="Atau Tempel Link URL Foto..."
                            value={itemImage}
                            onChange={(e) => setItemImage(e.target.value)}
                            className="w-full bg-white border border-neutral-300 rounded-2xl p-2.5 text-xs font-medium focus:outline-none focus:border-black"
                          />
                        </div>
                      </div>

                      <div className="flex space-x-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setIsAddingItem(false)}
                          className="flex-1 py-2.5 rounded-2xl border border-neutral-300 text-xs font-bold hover:bg-neutral-100"
                        >
                          Batal
                        </button>
                        <button
                          type="submit"
                          className="flex-1 bg-neutral-950 hover:bg-black text-white py-2.5 rounded-2xl text-xs font-black uppercase tracking-wider shadow-md active:scale-95"
                        >
                          {editingItemId ? 'Simpan Perubahan' : 'Terbitkan Produk'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* MY SHOP PRODUCTS LIST */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="font-black text-xs uppercase text-neutral-500 tracking-wider">
                      Daftar Produk di Etalase ({myShopItems.length})
                    </h3>
                  </div>

                  {myShopItems.length === 0 ? (
                    <div className="bg-white rounded-3xl border border-neutral-200 p-8 text-center space-y-2">
                      <p className="text-xs text-neutral-400 font-bold">Toko Anda belum memiliki produk yang dipajang.</p>
                      <button
                        onClick={() => setIsAddingItem(true)}
                        className="mt-2 bg-neutral-950 text-white text-xs font-bold px-4 py-2 rounded-full shadow-md hover:bg-black transition-all cursor-pointer"
                      >
                        + Tambah Produk Pertama
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {myShopItems.map(item => (
                        <div
                          key={item.id}
                          className="bg-white border border-neutral-200/90 rounded-3xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs hover:border-black/20 transition-all"
                        >
                          <div className="flex items-center space-x-3 min-w-0">
                            <img
                              src={item.imageURL}
                              alt={item.name}
                              className="w-14 h-14 rounded-2xl object-cover bg-neutral-100 shrink-0 border border-neutral-200 shadow-xs"
                            />
                            <div className="min-w-0 flex-1">
                              <h4 className="font-bold text-xs sm:text-sm text-neutral-900 truncate">{item.name}</h4>
                              <div className="flex items-center space-x-2 mt-1 flex-wrap gap-y-1">
                                <span className="text-xs text-neutral-900 font-black">
                                  Rp {item.price.toLocaleString('id-ID')}
                                </span>
                                <span className="text-[10px] text-neutral-400 font-semibold">•</span>
                                <span className="text-[10px] text-neutral-500 font-bold">Stok: {item.stock}</span>
                                <span className="text-[9px] bg-neutral-100 text-neutral-600 font-black px-2 py-0.5 rounded-md capitalize">
                                  {item.category}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-end space-x-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-neutral-100">
                            <div className="flex items-center bg-neutral-100 rounded-xl p-1 space-x-1">
                              <button
                                onClick={() => handleQuickStockUpdate(item.id, -1)}
                                className="w-6 h-6 rounded-lg bg-white hover:bg-neutral-200 text-neutral-700 font-bold flex items-center justify-center text-xs shadow-2xs"
                                title="Kurangi Stok (-1)"
                              >
                                -
                              </button>
                              <span className="text-xs font-black px-1.5">{item.stock}</span>
                              <button
                                onClick={() => handleQuickStockUpdate(item.id, 1)}
                                className="w-6 h-6 rounded-lg bg-white hover:bg-neutral-200 text-neutral-700 font-bold flex items-center justify-center text-xs shadow-2xs"
                                title="Tambah Stok (+1)"
                              >
                                +
                              </button>
                            </div>

                            <button
                              onClick={() => handleEditItemClick(item)}
                              className="w-9 h-9 rounded-xl bg-neutral-100 text-neutral-700 hover:bg-black hover:text-white flex items-center justify-center text-xs transition-colors cursor-pointer"
                              title="Edit Produk"
                            >
                              <i className="fas fa-pencil"></i>
                            </button>
                            <button
                              onClick={() => handleDeleteItem(item.id, item.name)}
                              className="w-9 h-9 rounded-xl bg-red-50 text-red-600 hover:bg-red-600 hover:text-white flex items-center justify-center text-xs transition-colors cursor-pointer"
                              title="Hapus Produk"
                            >
                              <i className="fas fa-trash-can"></i>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 3: ORDERS & TRANSACTION CHATS / PESANAN & TRANSAKSI */}
        {/* ============================================================= */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
            <div className="bg-white p-1 rounded-2xl border border-neutral-200 flex space-x-1 shadow-xs">
              <button
                onClick={() => setOrdersSubTab('incoming')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
                  ordersSubTab === 'incoming'
                    ? 'bg-neutral-950 text-white shadow-md'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                <i className="fas fa-inbox"></i>
                <span>Pesanan Masuk ({incomingOrders.length})</span>
              </button>

              <button
                onClick={() => setOrdersSubTab('my_purchases')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
                  ordersSubTab === 'my_purchases'
                    ? 'bg-neutral-950 text-white shadow-md'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                <i className="fas fa-bag-shopping"></i>
                <span>Pesanan Saya ({myPurchases.length})</span>
              </button>

              <button
                onClick={() => setOrdersSubTab('guide')}
                className={`flex-1 py-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
                  ordersSubTab === 'guide'
                    ? 'bg-neutral-950 text-white shadow-md'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                <i className="fas fa-circle-question"></i>
                <span>Panduan</span>
              </button>
            </div>

            {/* INCOMING ORDERS (SELLER VIEW) */}
            {ordersSubTab === 'incoming' && (
              <div className="space-y-3">
                {incomingOrders.length === 0 ? (
                  <div className="bg-white rounded-3xl border border-neutral-200 p-10 text-center space-y-2 shadow-xs">
                    <div className="w-14 h-14 rounded-full bg-neutral-100 text-neutral-400 flex items-center justify-center text-xl mx-auto">
                      <i className="fas fa-inbox"></i>
                    </div>
                    <h3 className="font-black text-sm text-neutral-800 uppercase">Belum Ada Pesanan Masuk</h3>
                    <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                      Pesanan dari pembeli untuk toko Anda akan otomatis terdata di sini lengkap dengan status dan tombol chat.
                    </p>
                  </div>
                ) : (
                  incomingOrders.map(order => (
                    <div
                      key={order.id}
                      className="bg-white border border-neutral-200/90 rounded-3xl p-4 shadow-xs space-y-3"
                    >
                      <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] font-black uppercase text-neutral-400">
                            #{order.id.slice(-6).toUpperCase()}
                          </span>
                          <span className="text-[10px] text-neutral-400">•</span>
                          <span className="text-[10px] text-neutral-500 font-semibold">
                            {new Date(order.timestamp).toLocaleString('id-ID')}
                          </span>
                        </div>

                        <span className={`text-[9px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                          order.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                          order.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                          order.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {order.status === 'completed' ? 'Selesai' :
                           order.status === 'processing' ? 'Diproses' :
                           order.status === 'cancelled' ? 'Batal' : 'Menunggu Konfirmasi'}
                        </span>
                      </div>

                      <div className="flex items-center space-x-3.5">
                        {order.itemImage ? (
                          <img src={order.itemImage} alt={order.itemName} className="w-14 h-14 rounded-2xl object-cover bg-neutral-100 shrink-0" />
                        ) : (
                          <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center text-lg font-black shrink-0">
                            <i className="fas fa-box"></i>
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <h4 className="font-extrabold text-xs sm:text-sm text-neutral-900 truncate">{order.itemName}</h4>
                          <p className="text-xs text-neutral-600 font-bold mt-0.5">
                            {order.quantity} pcs x Rp {order.price.toLocaleString('id-ID')} = <span className="font-black text-neutral-900">Rp {order.totalPrice.toLocaleString('id-ID')}</span>
                          </p>
                          <p className="text-[10px] text-neutral-500 font-medium mt-1">
                            Pembeli: <strong className="text-neutral-800">{order.buyerName}</strong>
                          </p>
                          {order.notes && (
                            <p className="text-[10px] text-amber-900 bg-amber-50 p-1.5 rounded-xl mt-1.5 border border-amber-200">
                              Catatan: "{order.notes}"
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-100">
                        <div className="flex items-center space-x-1.5">
                          {order.status === 'pending' && (
                            <button
                              onClick={() => handleUpdateOrderStatus(order.id, 'processing')}
                              className="bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black px-3 py-1.5 rounded-xl uppercase transition-colors"
                            >
                              Proses Pesanan
                            </button>
                          )}
                          {order.status === 'processing' && (
                            <button
                              onClick={() => handleUpdateOrderStatus(order.id, 'completed')}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black px-3 py-1.5 rounded-xl uppercase transition-colors"
                            >
                              Tandai Selesai
                            </button>
                          )}
                          {order.status !== 'cancelled' && order.status !== 'completed' && (
                            <button
                              onClick={() => handleUpdateOrderStatus(order.id, 'cancelled')}
                              className="bg-neutral-100 hover:bg-red-50 text-neutral-600 hover:text-red-600 text-[10px] font-bold px-2.5 py-1.5 rounded-xl uppercase transition-colors"
                            >
                              Batalkan
                            </button>
                          )}
                        </div>

                        {onNavigateToChat && (
                          <button
                            onClick={() => onNavigateToChat(order.buyerId, `Halo ${order.buyerName}, mengenai pesanan #${order.id.slice(-6).toUpperCase()} (${order.itemName})...`)}
                            className="bg-neutral-950 hover:bg-black text-white text-[10px] font-black px-3.5 py-1.5 rounded-xl uppercase flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
                          >
                            <i className="fas fa-comment-dots text-amber-400"></i>
                            <span>Chat Pembeli</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* OUTGOING PURCHASES (BUYER VIEW) */}
            {ordersSubTab === 'my_purchases' && (
              <div className="space-y-3">
                {myPurchases.length === 0 ? (
                  <div className="bg-white rounded-3xl border border-neutral-200 p-10 text-center space-y-2 shadow-xs">
                    <div className="w-14 h-14 rounded-full bg-neutral-100 text-neutral-400 flex items-center justify-center text-xl mx-auto">
                      <i className="fas fa-bag-shopping"></i>
                    </div>
                    <h3 className="font-black text-sm text-neutral-800 uppercase">Belum Ada Riwayat Pembelian</h3>
                    <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                      Jelajahi pasar dan pesan produk impian Anda dari penjual terpercaya di Vimos!
                    </p>
                    <button
                      onClick={() => setActiveTab('explore')}
                      className="mt-2 bg-neutral-950 text-white text-xs font-bold px-5 py-2.5 rounded-full shadow-md hover:bg-black transition-all cursor-pointer"
                    >
                      Mulai Belanja
                    </button>
                  </div>
                ) : (
                  myPurchases.map(order => (
                    <div
                      key={order.id}
                      className="bg-white border border-neutral-200/90 rounded-3xl p-4 shadow-xs space-y-3"
                    >
                      <div className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] font-black uppercase text-neutral-400">
                            #{order.id.slice(-6).toUpperCase()}
                          </span>
                          <span className="text-[10px] text-neutral-400">•</span>
                          <span className="text-[10px] text-neutral-500 font-semibold">
                            Toko: <strong className="text-neutral-900">{order.shopName}</strong>
                          </span>
                        </div>

                        <span className={`text-[9px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                          order.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                          order.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                          order.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {order.status === 'completed' ? 'Selesai' :
                           order.status === 'processing' ? 'Diproses' :
                           order.status === 'cancelled' ? 'Batal' : 'Menunggu Konfirmasi'}
                        </span>
                      </div>

                      <div className="flex items-center space-x-3.5">
                        {order.itemImage ? (
                          <img src={order.itemImage} alt={order.itemName} className="w-14 h-14 rounded-2xl object-cover bg-neutral-100 shrink-0" />
                        ) : (
                          <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center text-lg font-black shrink-0">
                            <i className="fas fa-box"></i>
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <h4 className="font-extrabold text-xs sm:text-sm text-neutral-900 truncate">{order.itemName}</h4>
                          <p className="text-xs text-neutral-600 font-bold mt-0.5">
                            {order.quantity} unit • Total: <span className="font-black text-neutral-900">Rp {order.totalPrice.toLocaleString('id-ID')}</span>
                          </p>
                          {order.notes && (
                            <p className="text-[10px] text-neutral-500 italic mt-0.5">
                              Catatan: "{order.notes}"
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-end pt-2 border-t border-neutral-100">
                        {onNavigateToChat && (
                          <button
                            onClick={() => onNavigateToChat(order.sellerId, `Halo, saya ingin menanyakan status pesanan #${order.id.slice(-6).toUpperCase()} (${order.itemName})...`)}
                            className="bg-neutral-950 hover:bg-black text-white text-[10px] font-black px-3.5 py-1.5 rounded-xl uppercase flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
                          >
                            <i className="fas fa-comment-dots text-amber-400"></i>
                            <span>Chat Penjual</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* GUIDE SUB-TAB */}
            {ordersSubTab === 'guide' && (
              <div className="bg-white border border-neutral-200/90 rounded-3xl p-5 shadow-xs space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-2xl bg-amber-400 text-black flex items-center justify-center text-lg font-black shrink-0 shadow-sm">
                    <i className="fas fa-shield-halved"></i>
                  </div>
                  <div>
                    <h2 className="font-black text-sm text-neutral-900 uppercase">Panduan Transaksi Aman Marketplace</h2>
                    <p className="text-xs text-neutral-500 mt-0.5">Tata cara transaksi & komunikasi jual beli di Vimos.</p>
                  </div>
                </div>

                <div className="space-y-2.5 text-xs text-neutral-700 leading-relaxed">
                  <div className="p-3.5 bg-neutral-50 border border-neutral-200 rounded-2xl space-y-1">
                    <h4 className="font-extrabold text-neutral-900 flex items-center space-x-1.5">
                      <span className="w-5 h-5 rounded-full bg-black text-white text-[10px] flex items-center justify-center">1</span>
                      <span>Pilih Produk & Buat Pesanan</span>
                    </h4>
                    <p className="text-[11px] text-neutral-600 pl-6">
                      Tentukan jumlah dan isi catatan khusus. Sistem akan mencatat pesanan resmi Anda.
                    </p>
                  </div>

                  <div className="p-3.5 bg-neutral-50 border border-neutral-200 rounded-2xl space-y-1">
                    <h4 className="font-extrabold text-neutral-900 flex items-center space-x-1.5">
                      <span className="w-5 h-5 rounded-full bg-black text-white text-[10px] flex items-center justify-center">2</span>
                      <span>Konfirmasi & Chat Langsung dengan Penjual</span>
                    </h4>
                    <p className="text-[11px] text-neutral-600 pl-6">
                      Invoice otomatis terkirim ke obrolan langsung (Direct Chat). Anda dan penjual dapat bersepakat mengenai opsi transfer/COD/kurir.
                    </p>
                  </div>

                  <div className="p-3.5 bg-neutral-50 border border-neutral-200 rounded-2xl space-y-1">
                    <h4 className="font-extrabold text-neutral-900 flex items-center space-x-1.5">
                      <span className="w-5 h-5 rounded-full bg-black text-white text-[10px] flex items-center justify-center">3</span>
                      <span>Pantau Status Transaksi Realtime</span>
                    </h4>
                    <p className="text-[11px] text-neutral-600 pl-6">
                      Penjual dapat mengubah status pesanan dari "Menunggu", "Diproses", hingga "Selesai" yang dapat dipantau di tab Pesanan.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ============================================================= */}
      {/* CHECKOUT & DIRECT BUY FULL SCREEN PAGE */}
      {/* ============================================================= */}
      {selectedItemToBuy && (() => {
        const itemShop = shops.find(s => s.id === selectedItemToBuy.shopId || s.ownerId === selectedItemToBuy.ownerId);
        const totalPrice = selectedItemToBuy.price * buyQuantity;

        return (
          <div className="fixed inset-0 z-[150] bg-neutral-50 text-neutral-900 flex flex-col animate-fade-in overflow-hidden">
            {/* Top Navigation Bar */}
            <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-neutral-200 px-4 sm:px-6 py-3.5 flex items-center justify-between shadow-2xs">
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => setSelectedItemToBuy(null)}
                  className="w-10 h-10 rounded-2xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 hover:text-black flex items-center justify-center transition-all cursor-pointer active:scale-95 shadow-xs"
                  title="Kembali"
                >
                  <i className="fas fa-arrow-left text-sm"></i>
                </button>
                <div>
                  <h1 className="text-base sm:text-lg font-black uppercase tracking-tight text-neutral-900 leading-tight">
                    Checkout & Pembelian
                  </h1>
                  <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider">
                    Vimos Official Storefront
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedItemToBuy(null)}
                className="text-xs font-black uppercase tracking-wider px-3.5 py-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-600 hover:text-black transition-colors cursor-pointer"
              >
                Batal
              </button>
            </header>

            {/* Scrollable Checkout Content */}
            <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 max-w-2xl mx-auto w-full space-y-6">
              {/* Product Hero Banner */}
              <div className="bg-white rounded-3xl p-5 sm:p-6 border border-neutral-200/90 shadow-sm space-y-5">
                <div className="relative w-full aspect-square max-h-80 sm:max-h-96 rounded-2xl overflow-hidden bg-neutral-100 border border-neutral-200 flex items-center justify-center shadow-inner">
                  <img
                    src={selectedItemToBuy.imageURL}
                    alt={selectedItemToBuy.name}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                    <span className="px-3 py-1 bg-black/80 backdrop-blur-md text-white text-[10px] font-black uppercase rounded-full tracking-wider shadow-md">
                      {selectedItemToBuy.category || 'Produk'}
                    </span>
                    <span className={`px-3 py-1 backdrop-blur-md text-[10px] font-black uppercase rounded-full tracking-wider shadow-md ${
                      selectedItemToBuy.stock > 0 
                        ? 'bg-emerald-600 text-white' 
                        : 'bg-red-600 text-white'
                    }`}>
                      Stok: {selectedItemToBuy.stock} Pcs
                    </span>
                  </div>
                </div>

                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-neutral-900 leading-snug">
                    {selectedItemToBuy.name}
                  </h2>
                  <div className="mt-2 flex items-baseline space-x-2">
                    <span className="text-2xl sm:text-3xl font-black text-neutral-950 tracking-tight">
                      Rp {selectedItemToBuy.price.toLocaleString('id-ID')}
                    </span>
                    <span className="text-xs text-neutral-400 font-semibold uppercase tracking-wider">
                      / unit
                    </span>
                  </div>
                </div>

                {selectedItemToBuy.description && (
                  <div className="pt-4 border-t border-neutral-100">
                    <h4 className="text-[11px] font-black uppercase tracking-wider text-neutral-400 mb-1.5">
                      Deskripsi Barang
                    </h4>
                    <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed whitespace-pre-line bg-neutral-50 p-3.5 rounded-2xl border border-neutral-100">
                      {selectedItemToBuy.description}
                    </p>
                  </div>
                )}
              </div>

              {/* Seller / Store Information Card */}
              <div className="bg-white rounded-3xl p-5 border border-neutral-200/90 shadow-sm flex items-center justify-between">
                <div className="flex items-center space-x-3.5 min-w-0">
                  <div className="relative shrink-0">
                    <img
                      src={itemShop?.ownerPhoto || `https://api.dicebear.com/7.x/initials/svg?seed=${selectedItemToBuy.ownerId}`}
                      alt={selectedItemToBuy.ownerName}
                      className="w-12 h-12 rounded-2xl object-cover border border-neutral-200 bg-neutral-100 shadow-2xs"
                    />
                    <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-amber-400 text-black text-[9px] rounded-full flex items-center justify-center font-black shadow-xs">
                      <i className="fas fa-check"></i>
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center space-x-1.5">
                      <h3 className="font-black text-sm uppercase text-neutral-900 truncate">
                        {itemShop?.name || selectedItemToBuy.ownerName}
                      </h3>
                      <span className="bg-amber-100 text-amber-800 text-[8px] font-black px-1.5 py-0.5 rounded uppercase">
                        Verified
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500 font-medium truncate mt-0.5">
                      {itemShop?.city && itemShop?.province 
                        ? `${itemShop.city}, ${itemShop.province}` 
                        : 'Penjual Terverifikasi Vimos'}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 bg-neutral-100 text-neutral-700 rounded-full border border-neutral-200">
                    Official Seller
                  </span>
                </div>
              </div>

              {/* Order Quantity & Customization Section */}
              <div className="bg-white rounded-3xl p-5 sm:p-6 border border-neutral-200/90 shadow-sm space-y-4">
                <h3 className="text-xs font-black uppercase tracking-wider text-neutral-900 flex items-center space-x-2">
                  <i className="fas fa-boxes-stacked text-neutral-500"></i>
                  <span>Atur Jumlah Pesanan</span>
                </h3>

                <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-2xl border border-neutral-200/80">
                  <div>
                    <p className="text-xs font-bold text-neutral-800">Jumlah Beli</p>
                    <p className="text-[10px] text-neutral-400">Tersedia {selectedItemToBuy.stock} unit</p>
                  </div>

                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      onClick={() => setBuyQuantity(Math.max(1, buyQuantity - 1))}
                      disabled={buyQuantity <= 1}
                      className="w-9 h-9 rounded-xl bg-white border border-neutral-300 font-black text-base flex items-center justify-center hover:bg-neutral-100 active:scale-95 disabled:opacity-40 transition-all cursor-pointer shadow-2xs"
                    >
                      -
                    </button>
                    <span className="font-black text-lg text-neutral-900 w-8 text-center">
                      {buyQuantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => setBuyQuantity(Math.min(selectedItemToBuy.stock, buyQuantity + 1))}
                      disabled={buyQuantity >= selectedItemToBuy.stock}
                      className="w-9 h-9 rounded-xl bg-white border border-neutral-300 font-black text-base flex items-center justify-center hover:bg-neutral-100 active:scale-95 disabled:opacity-40 transition-all cursor-pointer shadow-2xs"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Buyer Notes / Instructions Field */}
                <div className="space-y-1.5 pt-2">
                  <label className="text-[11px] font-black uppercase tracking-wider text-neutral-700 block">
                    Catatan Pembeli (Alamat Lengkap / Warna / Ukuran / No. WA):
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Contoh: Warna Hitam, Ukuran XL. Alamat: Jl. Melati No. 12, Jakarta Selatan. No WA: 08123456789"
                    value={buyerNotes}
                    onChange={(e) => setBuyerNotes(e.target.value)}
                    className="w-full bg-neutral-50 border border-neutral-300 rounded-2xl p-3.5 text-xs font-medium focus:outline-none focus:bg-white focus:border-black transition-all resize-none shadow-inner"
                  />
                  <p className="text-[10px] text-neutral-400 italic">
                    *Catatan ini akan otomatis terlampir di kartu invoice chat kepada penjual.
                  </p>
                </div>
              </div>

              {/* Payment Summary Box */}
              <div className="bg-white rounded-3xl p-5 border border-neutral-200/90 shadow-sm space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-neutral-900">
                  Rincian Pembayaran
                </h3>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-neutral-600">
                    <span>Harga Satuan:</span>
                    <span className="font-semibold text-neutral-800">
                      Rp {selectedItemToBuy.price.toLocaleString('id-ID')}
                    </span>
                  </div>
                  <div className="flex justify-between text-neutral-600">
                    <span>Jumlah Unit:</span>
                    <span className="font-semibold text-neutral-800">
                      {buyQuantity} Pcs
                    </span>
                  </div>
                  <div className="pt-2 border-t border-neutral-100 flex justify-between items-baseline font-black text-neutral-900 text-sm">
                    <span>Total Tagihan:</span>
                    <span className="text-xl font-black text-black">
                      Rp {totalPrice.toLocaleString('id-ID')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Safety & Chat Guarantee Banner */}
              <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-2xl text-[11px] text-emerald-800 leading-relaxed flex items-start space-x-3 shadow-2xs">
                <i className="fas fa-shield-halved text-emerald-600 text-base mt-0.5 shrink-0"></i>
                <div>
                  <p className="font-bold">Transaksi Langsung Aman & Terhubung ke Chat</p>
                  <p className="text-[10px] text-emerald-700 mt-0.5">
                    Setelah Anda menekan tombol pesan di bawah, invoice resmi akan otomatis terbit dan dikirim langsung ke ruang obrolan Anda dengan {selectedItemToBuy.ownerName}.
                  </p>
                </div>
              </div>

              <div className="h-20"></div>
            </main>

            {/* Bottom Fixed Action Bar */}
            <footer className="sticky bottom-0 z-20 bg-white/95 backdrop-blur-md border-t border-neutral-200 px-4 sm:px-6 py-4 shadow-xl">
              <div className="max-w-2xl mx-auto flex items-center justify-between space-x-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">
                    Total Pembayaran
                  </p>
                  <p className="text-lg sm:text-2xl font-black text-black truncate">
                    Rp {totalPrice.toLocaleString('id-ID')}
                  </p>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelectedItemToBuy(null)}
                    className="px-4 py-3 rounded-2xl border border-neutral-300 text-neutral-700 text-xs font-bold hover:bg-neutral-100 transition-all cursor-pointer"
                  >
                    Batal
                  </button>

                  <button
                    type="button"
                    disabled={isProcessingOrder}
                    onClick={handleProceedBuyOrder}
                    className="px-6 py-3 rounded-2xl bg-black hover:bg-neutral-800 text-white text-xs font-black uppercase tracking-wider shadow-lg hover:shadow-xl transition-all active:scale-95 disabled:opacity-50 flex items-center space-x-2 cursor-pointer"
                  >
                    {isProcessingOrder ? (
                      <>
                        <i className="fas fa-spinner fa-spin text-sm"></i>
                        <span>Memproses Pesanan...</span>
                      </>
                    ) : (
                      <>
                        <i className="fas fa-paper-plane text-xs text-amber-400"></i>
                        <span>Pesan & Chat Penjual</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </footer>
          </div>
        );
      })()}

      {/* CUSTOM CONFIRMATION MODAL POP-UP */}
      {confirmModal && confirmModal.isOpen && (
        <div className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-neutral-100 text-center space-y-4 animate-scale-up">
            <div className="w-14 h-14 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto text-xl shadow-inner">
              <i className="fas fa-trash-can"></i>
            </div>
            <div>
              <h3 className="font-extrabold text-lg text-neutral-900">{confirmModal.title}</h3>
              <p className="text-xs text-neutral-500 mt-1.5 leading-relaxed">{confirmModal.message}</p>
            </div>
            <div className="flex space-x-2 pt-2">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 py-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold text-xs rounded-2xl transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  confirmModal.onConfirm();
                }}
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs rounded-2xl shadow-lg transition-all active:scale-95 cursor-pointer"
              >
                {confirmModal.confirmText || 'Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Shop;
