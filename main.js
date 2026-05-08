document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // INITIALIZATION & STATE
    // ==========================================
    const API_URL = '/api';
    const SOCKET_URL = window.location.origin; 
    let selectedSystem = localStorage.getItem('selectedSystem') || null;
    let cachedEmpresas = [];
    let cachedContratos = [];
    let cachedPostos = [];

    // 1. Inicializa Componentes Básicos
    initTheme();
    initNavigation();
    initSystemSelection();
    setupAuthEvents();

    // 2. Decide o Estado do App Baseado no LocalStorage (ORDEM CRÍTICA)
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (currentUser) {
        // Usuário logado: Oculta login e decide se mostra seletor ou app
        document.getElementById('login-container').style.display = 'none';
        
        // GLOBAL PERMISSION CHECK: Hide master-only features if not master
        if (currentUser.role !== 'master') {
            document.querySelectorAll('.master-only').forEach(el => el.style.display = 'none');
        }

        if (!selectedSystem) {
            showSystemSelection();
        } else {
            showMainApp();
            loadAppData(); // Carrega dados do sistema selecionado
        }
        
        // Valida sessão em "background"
        validateSession();
    } else {
        // Usuário deslogado: Mostra tela de login
        showLoginScreen();
    }

    // 3. Conectar ao servidor em tempo real (Socket.IO)
    initRealtimeSocket();

    function initRealtimeSocket() {
        if (typeof io !== 'undefined') {
            const socket = io(SOCKET_URL, {
                reconnectionAttempts: 5,
                timeout: 5000,
                transports: ['polling'],
                path: '/socket.io'
            });
            socket.on('data-updated', () => {
                console.log('Dados atualizados via Socket.');
                fetchAllData();
            });
            socket.on('connect_error', () => {
                startPolling(); // Fallback se o socket falhar
            });
        } else {
            startPolling();
        }
    }

    let pollingInterval = null;
    function startPolling() {
        if (pollingInterval) return; 
        console.log('Sincronização periódica iniciada (cada 3s).');
        pollingInterval = setInterval(() => {
            if (localStorage.getItem('currentUser') && selectedSystem) {
                fetchAllData();
            }
        }, 3000); // Atualiza a cada 3 segundos para ser quase instantâneo
    }

    // ==========================================
    // CURRENCY HELPERS & MASKS
    // ==========================================
    function formatCurrency(value) {
        if (!value && value !== 0) return 'R$ 0,00';
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(value);
    }

    function maskCurrency(e) {
        let value = e.target.value.replace(/\D/g, "");
        value = (value / 100).toFixed(2) + "";
        value = value.replace(".", ",");
        value = value.replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1.");
        e.target.value = "R$ " + value;
    }

    function parseCurrency(str) {
        if (!str) return 0;
        return parseFloat(str.replace(/[^\d,]/g, "").replace(",", "."));
    }

    function formatDate(dateString) {
        if (!dateString) return '-';
        const d = new Date(dateString);
        if (isNaN(d.getTime())) return dateString;
        return d.toLocaleDateString('pt-BR');
    }

    // Apply masks to inputs
    ['con-valormensal', 'con-valordiario', 'con-valorkm'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.type = "text"; // Change to text for mask
            input.addEventListener('input', maskCurrency);
        }
    });

    // ==========================================
    // GLOBAL SYNC ON CLICK (Solicitado pelo Usuário)
    // ==========================================
    document.addEventListener('click', (e) => {
        // Se clicar em qualquer botão ou em qualquer item dentro da sidebar (incluindo ícones e links)
        if (e.target.closest('button') || e.target.closest('.sidebar-menu li')) {
            if (localStorage.getItem('currentUser') && selectedSystem) {
                console.log('Ação detectada em menu/botão. Sincronizando dados...');
                fetchAllData().then(() => {
                    loadDashboardStats();
                    loadEmpresasTable();
                    loadContratosTable();
                });
            }
        }
    });

    async function validateSession() {
        const user = JSON.parse(localStorage.getItem('currentUser'));
        if (!user) return;
        
        const username = user.usuario || user.user;
        if (!username) return;

        try {
            const res = await fetch(`${API_URL}/auth/verify?usuario=${username}`);
            if (!res.ok) {
                // Sessão inválida ou usuário removido
                localStorage.removeItem('currentUser');
                localStorage.removeItem('selectedSystem');
                window.location.reload();
            }
        } catch (e) {
            console.warn('Erro ao validar sessão, mas mantendo login local:', e);
        }
    }

    async function loadAppData() {
        try {
            await fetchAllData();
            loadDashboardStats();
            loadEmpresasTable();
            loadContratosTable();
            populateEmpresasSelect();
            updateSidebarVisibility();

            // Ativa o carregamento das tabelas de faturamento e postos
            if (typeof loadContratosFaturamentosTable === 'function') loadContratosFaturamentosTable();
            if (typeof loadPostosDashboard === 'function') loadPostosDashboard(currentPostoServico || 'Merendeiras');
        } catch (e) {
            console.error('Erro ao carregar app data:', e);
        }
    }

    async function fetchAllData() {
        try {
            // Adicionamos ?t=TIMESTAMP para forçar o navegador a buscar dado NOVO do servidor
            const time = Date.now();
            const [empRes, conRes, posRes] = await Promise.all([
                fetch(`${API_URL}/empresas?system=${selectedSystem}&t=${time}`),
                fetch(`${API_URL}/contratos?system=${selectedSystem}&t=${time}`),
                fetch(`${API_URL}/postos?t=${time}`)
            ]);
            cachedEmpresas = await empRes.json();
            
            // Map Snake Case from DB to Camel Case for Frontend compatibility
            const rawContratos = await conRes.json();
            cachedContratos = rawContratos.map(c => ({
                ...c,
                empresaId: c.empresa_id,
                periodoInicial: c.periodo_inicial ? c.periodo_inicial.substring(0, 10) : '',
                periodoFinal: c.periodo_final ? c.periodo_final.substring(0, 10) : '',
                valorDiario: c.valor_diario,
                valorKm: c.valor_km,
                valorMensal: c.valor_mensal,
                anexos: typeof c.anexos === 'string' ? JSON.parse(c.anexos || '[]') : (c.anexos || [])
            }));

            cachedPostos = await posRes.json();
        } catch (error) {
            console.error('Erro ao carregar dados:', error);
            showToast('Erro ao conectar com o servidor.', 'error');
        }
    }

    function cleanUpLocalStorage() {
        let emps = JSON.parse(localStorage.getItem('empresas') || '[]');
        if (emps.some(e => e.razao === 'undefined' || !e.razao)) {
            emps = emps.filter(e => e.razao && e.razao !== 'undefined');
            localStorage.setItem('empresas', JSON.stringify(emps));
        }

        let cons = JSON.parse(localStorage.getItem('contratos') || '[]');
        if (cons.some(c => !c.tipo || c.tipo === 'undefined')) {
            cons = cons.filter(c => c.tipo && c.tipo !== 'undefined');
            localStorage.setItem('contratos', JSON.stringify(cons));
        }
    }

    // ==========================================
    // AUTHENTICATION SYSTEM
    // ==========================================
    
    // ==========================================
    // PASSWORD MANAGEMENT LOGIC
    // ==========================================
    
    // Forgot Password Flow
    const forgotLink = document.getElementById('link-forgot-password');
    const forgotModal = document.getElementById('forgot-password-modal');
    const forgotForm = document.getElementById('forgot-password-form');

    if (forgotLink) {
        forgotLink.addEventListener('click', (e) => {
            e.preventDefault();
            forgotModal.style.display = 'block';
        });
    }

    if (forgotForm) {
        forgotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const usuario = document.getElementById('forgot-user').value;
            const email = document.getElementById('forgot-email').value;

            try {
                const res = await fetch(`${API_URL}/auth/forgot-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario, email })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                
                showToast(data.message, 'success');
                forgotModal.style.display = 'none';
                forgotForm.reset();
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    }

    // Change Password Flow (Logged User - ELITE VERSION)
    const settingsModal = document.getElementById('settings-modal');
    const changePassFormElite = document.getElementById('change-password-form-elite');

    // Settings Modal & Profile Delegation
    document.addEventListener('click', (e) => {
        // Open Modal
        if (e.target.closest('#user-profile-trigger')) {
            if (settingsModal) {
                settingsModal.classList.remove('form-hidden');
                settingsModal.style.display = 'flex';
            }
        }

        // Switch Tabs in Modal
        const navItem = e.target.closest('.settings-nav-item');
        if (navItem) {
            const targetTab = navItem.getAttribute('data-tab');
            
            // UI Update
            document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
            navItem.classList.add('active');
            
            // Switch Content
            document.querySelectorAll('.settings-tab-content').forEach(tab => {
                tab.classList.add('hidden');
                tab.style.display = 'none'; // Force hide
            });
            const content = document.getElementById(`tab-${targetTab}`);
            if (content) {
                content.classList.remove('hidden');
                content.style.display = 'block'; // Force show
            }
        }

        // Select Theme Card
        const themeCard = e.target.closest('.theme-card');
        if (themeCard) {
            const themeName = themeCard.getAttribute('data-theme');
            setTheme(themeName);
        }
    });

    if (changePassFormElite) {
        changePassFormElite.addEventListener('submit', async (e) => {
            e.preventDefault();
            const senhaAtual = document.getElementById('elite-pass-current').value;
            const novaSenha = document.getElementById('elite-pass-new').value;
            const confirmarSenha = document.getElementById('elite-pass-confirm').value;
            
            const currentUser = JSON.parse(localStorage.getItem('currentUser'));
            if (!currentUser) return;

            if (novaSenha !== confirmarSenha) {
                return showToast('As senhas não coincidem!', 'error');
            }

            try {
                const res = await fetch(`${API_URL}/auth/change-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        usuario: currentUser.usuario, 
                        senhaAtual, 
                        novaSenha 
                    })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                
                showToast(data.message, 'success');
                settingsModal.classList.add('form-hidden');
                changePassFormElite.reset();
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    }

    // Modal Close Logic
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    });

    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal') || btn.closest('.modal-overlay');
            if (modal) {
                modal.style.display = 'none';
                modal.classList.add('form-hidden');
            }
        });
    });

    function initAuthSystem() {
        const currentUser = JSON.parse(localStorage.getItem('currentUser'));
        if (currentUser) {
            // Se já temos o usuário, garantimos que o login suma e aplicamos o login
            document.getElementById('login-container').style.display = 'none';
            applyLogin(currentUser);
        } else {
            // Só mostramos o login se NÃO houver usuário
            showLoginScreen();
        }
        setupAuthEvents();
    }

    function showLoginScreen() {
        document.getElementById('login-container').style.display = 'flex';
        document.getElementById('app-container').style.display = 'none';
        const selectionContainer = document.getElementById('system-selection-container');
        if (selectionContainer) selectionContainer.style.display = 'none';
        document.body.className = '';
    }

    function applyLogin(user) {
        document.getElementById('login-container').style.display = 'none';
        
        if (!selectedSystem) {
            showSystemSelection();
        } else {
            showMainApp();
        }

        // Aplica a classe de permissão no body (role-usuario, role-admin, role-master)
        document.body.className = `role-${user.role}`;

        // Setup username in topbar
        const topbarName = document.querySelector('.topbar h2');
        if (topbarName) {
            topbarName.textContent = `Bem-vindo, ${user.usuario}`;
        }

        // Notify pending requests if master
        if (user.role === 'master') {
            updateBadgeRequests();
            loadAprovacoesTable();
        }
    }

    function showSystemSelection() {
        const container = document.getElementById('system-selection-container');
        if (container) {
            container.style.display = 'flex';
            container.classList.remove('form-hidden');
        }
        document.getElementById('app-container').style.display = 'none';
        document.getElementById('login-container').style.display = 'none';
    }

    function showMainApp() {
        const selectionContainer = document.getElementById('system-selection-container');
        if (selectionContainer) {
            selectionContainer.style.display = 'none';
            selectionContainer.classList.add('form-hidden');
        }
        
        document.getElementById('app-container').style.display = 'block';
        loadAppData();
        
        // Update topbar with system name
        const topbarH2 = document.querySelector('.topbar h2');
        if (topbarH2) {
            const systemLabel = selectedSystem === 'transporte' ? 'Transporte Escolar' : 'Mão de Obra';
            const user = JSON.parse(localStorage.getItem('currentUser'));
            const username = user ? (user.usuario || user.user || 'Usuário') : 'Usuário';
            topbarH2.innerHTML = `Bem-vindo, ${username} <span style="margin-left: 10px; font-size: 14px; color: var(--primary-color); font-weight: 400;">(${systemLabel})</span>`;
        }
    }

    function initSystemSelection() {
        const btnMaoDeObra = document.getElementById('select-mao-de-obra');
        const btnTransporte = document.getElementById('select-transporte');
        const btnBackToLogin = document.getElementById('btn-back-to-login');

        if (btnMaoDeObra) {
            btnMaoDeObra.addEventListener('click', () => selectSystem('mao-de-obra'));
        }
        if (btnTransporte) {
            btnTransporte.addEventListener('click', () => selectSystem('transporte'));
        }
        if (btnBackToLogin) {
            btnBackToLogin.addEventListener('click', () => {
                localStorage.removeItem('currentUser');
                localStorage.removeItem('selectedSystem');
                selectedSystem = null;
                showLoginScreen();
            });
        }
        
        // Add "Switch System" button to sidebar
        const logoutZone = document.querySelector('.logout-zone');
        if (logoutZone) {
            const switchBtn = document.createElement('button');
            switchBtn.className = 'logout-btn';
            switchBtn.style.marginBottom = '10px';
            switchBtn.style.background = 'rgba(67, 97, 238, 0.1)';
            switchBtn.style.color = 'var(--primary-color)';
            switchBtn.innerHTML = "<i class='bx bx-repost'></i> Trocar de Sistema";
            switchBtn.onclick = () => {
                selectedSystem = null;
                localStorage.removeItem('selectedSystem');
                showSystemSelection();
            };
            logoutZone.prepend(switchBtn);
        }
    }

    function selectSystem(system) {
        selectedSystem = system;
        localStorage.setItem('selectedSystem', system);
        showToast(`Módulo ${system === 'transporte' ? 'Transporte Escolar' : 'Mão de Obra'} selecionado.`);
        showMainApp();
    }

    function updateSidebarVisibility() {
        const menuContratos = document.getElementById('menu-contratos');
        const menuFaturamentos = document.getElementById('menu-faturamentos');
        const menuPostos = document.getElementById('menu-postos');
        const menuIndenizatorios = document.getElementById('menu-indenizatorios');

        // Submenus
        const fatSubmenu = document.getElementById('submenu-faturamentos');
        const postSubmenu = document.getElementById('submenu-postos');
        
        if (selectedSystem === 'transporte') {
            if (menuContratos) menuContratos.closest('li').style.display = 'block';
            if (menuFaturamentos) menuFaturamentos.closest('li').style.display = 'block';
            if (menuPostos) menuPostos.closest('li').style.display = 'none';
            if (menuIndenizatorios) {
                const li = document.getElementById('menu-indenizatorios-li');
                if (li) li.style.display = 'block';
            }
            filterSubmenuItems(fatSubmenu, ['Transporte Escolar']);
        } else {
            // No Mão de Obra, mostramos TUDO
            if (menuContratos) menuContratos.closest('li').style.display = 'block';
            if (menuFaturamentos) menuFaturamentos.closest('li').style.display = 'block';
            if (menuPostos) menuPostos.closest('li').style.display = 'block';
            if (menuIndenizatorios) {
                const li = document.getElementById('menu-indenizatorios-li');
                if (li) li.style.display = 'none';
            }

            filterSubmenuItems(fatSubmenu, ['Merendeiras', 'Vigilância', 'Limpeza', 'Porteiros']);
            filterSubmenuItems(postSubmenu, ['Merendeiras', 'Vigilância', 'Limpeza', 'Porteiros']);
        }
    }

    function filterSubmenuItems(submenu, allowedTypes) {
        if (!submenu) return;
        const links = submenu.querySelectorAll('a');
        links.forEach(link => {
            const servico = link.getAttribute('data-servico');
            if (allowedTypes.includes(servico)) {
                link.parentElement.style.display = 'block';
            } else {
                link.parentElement.style.display = 'none';
            }
        });
    }

    function showBeautifulAlert(title, message, isError = false) {
        const modal = document.getElementById('message-modal');
        const iconDiv = document.getElementById('msg-icon');
        
        document.getElementById('msg-title').textContent = title;
        document.getElementById('msg-text').textContent = message;
        
        if (isError) {
            iconDiv.style.background = 'var(--danger-color)';
            iconDiv.innerHTML = "<i class='bx bx-error'></i>";
        } else {
            iconDiv.style.background = 'var(--success-color)';
            iconDiv.innerHTML = "<i class='bx bx-check'></i>";
        }
        
        modal.classList.remove('form-hidden');
        
        document.getElementById('btn-msg-ok').onclick = () => {
            modal.classList.add('form-hidden');
        };
    }

    function setupAuthEvents() {
        // Form Toggle
        const btnShowRequest = document.getElementById('btn-show-request');
        const btnCancelRequest = document.getElementById('btn-cancel-request');
        const loginBox = document.getElementById('login-form-box');
        const requestBox = document.getElementById('request-form-box');

        btnShowRequest.addEventListener('click', () => {
            loginBox.style.display = 'none';
            requestBox.style.display = 'block';
        });

        btnCancelRequest.addEventListener('click', () => {
            requestBox.style.display = 'none';
            loginBox.style.display = 'block';
        });


        // Logout
        document.getElementById('btn-logout').addEventListener('click', () => {
            localStorage.removeItem('currentUser');
            localStorage.removeItem('selectedSystem');
            selectedSystem = null;
            showLoginScreen();
            showToast('Você saiu do sistema.', 'success');
        });

        // Do regular Login
        document.getElementById('btn-do-login').addEventListener('click', async () => {
            const userIn = document.getElementById('login-user').value.trim();
            const passIn = document.getElementById('login-pass').value.trim();

            if (!userIn || !passIn) return showBeautifulAlert('Campos Vazios', 'Preencha o usuário e a senha.', true);

            try {
                const response = await fetch(`${API_URL}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario: userIn, senha: passIn })
                });
                const data = await response.json();

                if (data.success) {
                    localStorage.setItem('currentUser', JSON.stringify(data.user));
                    
                    // Permission Check on login
                    if (data.user.role !== 'master') {
                        document.querySelectorAll('.master-only').forEach(el => el.style.display = 'none');
                    } else {
                        document.querySelectorAll('.master-only').forEach(el => el.style.display = 'block');
                    }

                    applyLogin(data.user);
                    showToast('Login efetuado com sucesso!', 'success');
                } else {
                    showBeautifulAlert('Acesso Negado', data.error || data.message || 'Usuário ou senha inválidos!', true);
                }
            } catch (error) {
                showBeautifulAlert('Erro', 'Não foi possível conectar ao servidor.', true);
            }
        });

        // Real-time check removed to allow server to handle validation on submit.

        // Submit Request
        document.getElementById('btn-submit-request').addEventListener('click', async () => {
            const u = document.getElementById('req-user').value.trim();
            const e = document.getElementById('req-email').value.trim();
            const p = document.getElementById('req-pass').value.trim();

            if (!u || !e || !p) return showBeautifulAlert('Campos Obrigatórios', 'Preencha todos os campos para solicitar acesso.', true);
            
            try {
                const response = await fetch(`${API_URL}/acessos`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario: u, email: e, senha: p })
                });
                
                const data = await response.json();

                if (response.ok) {
                    showBeautifulAlert('Sucesso', 'Solicitação enviada.', false);
                    btnCancelRequest.click();
                    document.getElementById('req-user').value = '';
                    document.getElementById('req-email').value = '';
                    document.getElementById('req-pass').value = '';
                } else {
                    showBeautifulAlert('Não foi possível solicitar', data.message || 'Erro ao processar solicitação.', true);
                }
            } catch (error) {
                showBeautifulAlert('Erro de Conexão', 'Não foi possível conectar ao servidor. Verifique se o backend está ligado.', true);
            }
        });
    }

    // ==========================================
    // APROVAÇÕES (SECRET TAB) -> Master only
    // ==========================================
    async function updateBadgeRequests() {
        try {
            const response = await fetch(`${API_URL}/admin/acessos`);
            const data = await response.json();
            const pendsAcesso = data.solicitacoes.length;
            const pendsExclusao = data.exclusoes ? data.exclusoes.length : 0;
            const total = pendsAcesso + pendsExclusao;

            const badge = document.getElementById('badge-requests');
            if (total > 0) {
                badge.textContent = total;
                badge.style.opacity = '1';
            } else {
                badge.style.opacity = '0';
            }
        } catch (error) {}
    }

    async function loadAprovacoesTable() {
        const tbody = document.getElementById('lista-aprovacoes');
        if (!tbody) return;
        
        try {
            const response = await fetch(`${API_URL}/admin/acessos`);
            const data = await response.json();
            const reqs = data.solicitacoes;
            const users = data.usuarios;

            tbody.innerHTML = '';
            if (reqs.length === 0 && users.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--text-light)">Nenhum dado encontrado.</td></tr>`;
                return;
            }

            function renderAcessosTable(acessos) {
        const tbody = document.querySelector('#table-acessos tbody');
        if (!tbody) return;
        
        tbody.innerHTML = acessos.map(a => {
            const isReset = a.status === 'reset_pendente';
            const statusLabel = isReset ? '<span class="status-badge status-warning">Reset de Senha</span>' : `<span class="status-badge status-info">${a.status}</span>`;
            
            return `
                <tr>
                    <td>${a.usuario}</td>
                    <td>${a.email}</td>
                    <td>${a.perfil}</td>
                    <td>${statusLabel}</td>
                    <td>
                        <div class="table-actions">
                            ${isReset ? `
                                <button class="btn-icon btn-edit" onclick="handleResetPassword(${a.id}, '${a.usuario}')" title="Definir Nova Senha">
                                    <i class='bx bx-refresh'></i>
                                </button>
                            ` : `
                                <button class="btn-icon btn-edit" onclick="approveAcesso(${a.id})" title="Aprovar">
                                    <i class='bx bx-check'></i>
                                </button>
                            `}
                            <button class="btn-icon btn-delete" onclick="decideRequest(${a.id}, 'recusar')" title="${isReset ? 'Recusar Reset' : 'Recusar'}">
                                <i class='bx bx-trash'></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Admin Reset Function
    window.handleResetPassword = async function(solicitationId, username) {
        const novaSenha = prompt(`Digite a NOVA SENHA para o usuário "${username}":`);
        if (!novaSenha) return;

        try {
            // First, find the user ID by username (we'll do this in a single route)
            const usersRes = await fetch(`${API_URL}/usuarios?t=${Date.now()}`);
            const allUsers = await usersRes.json();
            const targetUser = allUsers.find(u => u.usuario === username);
            
            if (!targetUser) throw new Error('Usuário original não encontrado no banco.');

            const res = await fetch(`${API_URL}/admin/reset-password`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    id: targetUser.id, 
                    novaSenha, 
                    solicitacaoId: solicitationId 
                })
            });
            
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            
            showToast('Senha redefinida com sucesso!', 'success');
            fetchAcessos(); // Refresh table
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

            // Solicitações Pendentes
            reqs.forEach(req => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${req.usuario}</td>
                    <td>${req.email}</td>
                    <td><span class="badge Pendente">PENDENTE</span></td>
                    <td style="display: flex; gap: 8px;">
                        <button class="btn btn-primary" onclick="decideRequest('${req.id}', 'aceitar', 'usuario')" title="Aprovar como Usuário" style="padding: 6px 10px; font-size: 11px; background: #8d99ae;"><i class='bx bx-low-vision'></i> Usuário</button>
                        <button class="btn btn-primary" onclick="decideRequest('${req.id}', 'aceitar', 'admin')" title="Aprovar como Admin" style="padding: 6px 10px; font-size: 11px;"><i class='bx bx-shield-quarter'></i> Admin</button>
                        <button class="btn-icon" onclick="decideRequest('${req.id}', 'recusar')" title="Recusar" style="color:var(--danger-color)"><i class='bx bx-x-circle'></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            // Usuários Ativos (Gerenciamento)
            users.forEach(usr => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${usr.user}</td>
                    <td>-</td>
                    <td>
                        <select onchange="changeUserRole('${usr.user}', this.value)" style="padding: 4px; font-size: 12px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-color);">
                            <option value="usuario" ${usr.role === 'usuario' ? 'selected' : ''}>Usuário (Leitura)</option>
                            <option value="admin" ${usr.role === 'admin' ? 'selected' : ''}>Admin (Total)</option>
                        </select>
                    </td>
                    <td>
                        <button class="btn-icon" onclick="revokeAdmin('${usr.user}')" title="Excluir Usuário" style="color:var(--danger-color)"><i class='bx bx-trash'></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            // --- NOVO: Solicitações de Exclusão ---
            if (data.exclusoes && data.exclusoes.length > 0) {
                const headerExcl = document.createElement('tr');
                headerExcl.innerHTML = `<td colspan="4" style="background: rgba(0,0,0,0.05); font-weight: 700; padding: 10px 20px; font-size: 11px;">SOLICITAÇÕES DE EXCLUSÃO</td>`;
                tbody.appendChild(headerExcl);

                data.exclusoes.forEach(ex => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${ex.item_nome}</strong> <small style="color:var(--text-light)">(${ex.tipo})</small></td>
                        <td>Solictado por: ${ex.usuario}</td>
                        <td><span class="badge Pendente">AGUARDANDO</span></td>
                        <td style="display: flex; gap: 8px;">
                            <button class="btn btn-primary" onclick="decideExclusao('${ex.id}', 'aprovar')" title="Confirmar Exclusão" style="padding: 6px 10px; font-size: 11px; background: var(--danger-color);"><i class='bx bx-trash'></i> Excluir</button>
                            <button class="btn-icon" onclick="decideExclusao('${ex.id}', 'recusar')" title="Recusar" style="color:var(--text-light)"><i class='bx bx-x-circle'></i></button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } catch (error) {}
    }

    window.revokeAdmin = async function (username) {
        if (confirm(`Tem certeza que deseja EXCLUIR permanentemente o usuário '${username}'?`)) {
            try {
                const res = await fetch(`${API_URL}/admin/usuarios/${username}`, { method: 'DELETE' });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Erro ao remover usuário');
                
                showToast(`Usuário ${username} removido!`, 'success');
                loadAprovacoesTable();
            } catch (error) {
                console.error('Erro ao excluir usuário:', error);
                showToast(error.message, 'error');
            }
        }
    }

    window.changeUserRole = async function (username, newRole) {
        try {
            await fetch(`${API_URL}/admin/usuarios/${username}/role`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newRole })
            });
            showToast(`Perfil de ${username} alterado para ${newRole}!`, 'success');
            loadAprovacoesTable();
        } catch (error) {
            showToast('Erro ao alterar perfil.', 'error');
        }
    }

    window.decideRequest = async function (id, acao, role = 'usuario') {
        try {
            await fetch(`${API_URL}/admin/acessos/${id}/decide`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ acao, role })
            });
            const msg = acao === 'aceitar' ? `Aprovado como ${role}!` : 'Acesso recusado.';
            showToast(msg, 'success');
            loadAprovacoesTable();
            updateBadgeRequests();
        } catch (error) {}
    }

    window.decideExclusao = async function (id, acao) {
        if (acao === 'aprovar' && !confirm('Você tem certeza que deseja EXECUTAR esta exclusão solicitada?')) return;
        
        try {
            const res = await fetch(`${API_URL}/admin/exclusao/${id}/decide`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ acao })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao processar exclusão');

            showToast(acao === 'aprovar' ? 'Item excluído com sucesso!' : 'Solicitação recusada.');
            loadAprovacoesTable();
            updateBadgeRequests();
            fetchAllData(); // Refresh everything
        } catch (error) {
            console.error('Erro:', error);
            showToast(error.message, 'error');
        }
    }

    // ==========================================
    // THEME SYSTEM (MULTI-THEME)
    // ==========================================
    function setTheme(theme) {
        // Remove old theme and set new one
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        
        // Update selection UI if modal is open
        document.querySelectorAll('.theme-card').forEach(card => {
            if (card.getAttribute('data-theme') === theme) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });
    }

    function initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'blue';
        setTheme(savedTheme);
        
        if (localStorage.getItem('currentUser')) {
            const loginBox = document.getElementById('login-container');
            if (loginBox) loginBox.style.display = 'none';
        }
    }

    // Settings Modal logic consolidated above (line 259)
    // setTheme and initTheme are defined above/below 


    // ==========================================
    // NAVIGATION (SPA)
    // ==========================================
       function initNavigation() {
        // Seletores robustos para capturar cliques tanto em .nav-links quanto em .sidebar-menu
        const links = document.querySelectorAll('.nav-links a[data-target], .sidebar-menu a[data-target]');
        links.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = link.getAttribute('data-target');
                const servico = link.getAttribute('data-servico'); // Captura o filtro (Ex: Merendeiras)
                
                if (!targetId) return;

                console.log(`Link clicado: ${targetId} | Serviço: ${servico}`);

                // Update active link
                links.forEach(l => l.classList.remove('active'));
                link.classList.add('active');

                // ABRE A TELA ALVO
                if (typeof showView === 'function') showView(targetId, servico);
            });
        });

        // Toggle dos submenus (Faturamento e Postos)
        const menuFaturamentos = document.getElementById('menu-faturamentos');
        const menuPostos = document.getElementById('menu-postos');

        if (menuFaturamentos) {
            menuFaturamentos.onclick = (e) => {
                e.preventDefault();
                const sub = document.getElementById('submenu-faturamentos');
                const subPostos = document.getElementById('submenu-postos');
                if (sub) {
                    const isOpen = sub.style.display === 'block';
                    sub.style.display = isOpen ? 'none' : 'block';
                    menuFaturamentos.querySelector('.arrow')?.classList.toggle('rotate', !isOpen);
                    
                    if (!isOpen && subPostos) {
                        subPostos.style.display = 'none';
                        menuPostos.querySelector('.arrow')?.classList.remove('rotate');
                    }
                }
            };
        }
        if (menuPostos) {
            menuPostos.onclick = (e) => {
                e.preventDefault();
                const sub = document.getElementById('submenu-postos');
                const subFat = document.getElementById('submenu-faturamentos');
                if (sub) {
                    const isOpen = sub.style.display === 'block';
                    sub.style.display = isOpen ? 'none' : 'block';
                    menuPostos.querySelector('.arrow')?.classList.toggle('rotate', !isOpen);

                    if (!isOpen && subFat) {
                        subFat.style.display = 'none';
                        menuFaturamentos.querySelector('.arrow')?.classList.remove('rotate');
                    }
                }
            };
        }
    }

    function showView(targetId, servico = null) {
        console.log(`Tentando mostrar view: ${targetId} | Filtro: ${servico}`);
        const views = document.querySelectorAll('.view');
        
        const targetView = document.getElementById(targetId);
        if (!targetView) {
            console.error(`ERRO: A view com ID '${targetId}' não existe no HTML.`);
            return;
        }

        // Esconde todas as telas
        views.forEach(v => {
            v.style.display = 'none';
            v.classList.remove('active-view');
        });

        // Mostra a tela alvo
        targetView.style.display = 'block';
        targetView.classList.add('active-view');
        
        // Carregamento de dados específicos por tela
        if (targetId === 'dashboard') loadDashboardStats();
        if (targetId === 'contratos') {
            loadContratosTable();
            populateEmpresasSelect();
        }
        if (targetId === 'empresas') loadEmpresasTable();
        
        // Passa o serviço selecionado para as funções de faturamento e postos
        if (targetId === 'faturamentos-lista' && typeof loadContratosFaturamentosTable === 'function') {
            loadContratosFaturamentosTable(servico);
        }
        if (targetId === 'postos-lista' && typeof loadPostosDashboard === 'function') {
            document.getElementById('postos-group-title').textContent = servico ? `Gerenciamento de Postos - ${servico}` : 'Gerenciamento de Postos - Geral';
            loadPostosDashboard(servico);
        }
    }

    function updateContractTypeOptions() {
        const select = document.getElementById('con-tipo');
        if (!select) return;

        const allOptions = [
            { value: 'Merendeiras', text: 'Merendeiras', system: 'mao-de-obra' },
            { value: 'Limpeza', text: 'Limpeza', system: 'mao-de-obra' },
            { value: 'Vigilância', text: 'Vigilância', system: 'mao-de-obra' },
            { value: 'Porteiros', text: 'Porteiros', system: 'mao-de-obra' },
            { value: 'Transporte Escolar', text: 'Transporte Escolar', system: 'transporte' }
        ];

        select.innerHTML = '<option value="" disabled selected>Selecione um Tipo</option>';
        allOptions.forEach(opt => {
            if (opt.system === selectedSystem) {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.text;
                select.appendChild(o);
            }
        });
    }

    // ==========================================
    // NOTIFICATIONS (TOASTS)
    // ==========================================
    function showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icon = type === 'success' ? 'bx-check-circle' : 'bx-error-circle';

        toast.innerHTML = `
            <i class='bx ${icon}' style="font-size: 24px;"></i>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 3000);
    }

    // ==========================================
    // LOCAL STORAGE HELPERS
    // ==========================================
    function getEmpresas() {
        return cachedEmpresas;
    }

    function getContratos() {
        return cachedContratos;
    }

    async function saveEmpresas(empresa, isEdit = false) {
        const method = isEdit ? 'PUT' : 'POST';
        const url = isEdit ? `${API_URL}/empresas/${empresa.id}` : `${API_URL}/empresas`;
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(empresa)
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || data.message || 'Erro ao salvar empresa');
        }

        await fetchAllData();
        loadDashboardStats();
    }

    async function saveContratos(contrato, isEdit = false) {
        const method = isEdit ? 'PUT' : 'POST';
        const url = isEdit ? `${API_URL}/contratos/${contrato.id}` : `${API_URL}/contratos`;
        
        // Map frontend fields to DB fields if necessary (snake_case)
        const dbData = {
            numero: contrato.numero,
            proa: contrato.proa,
            lote: contrato.lote,
            cre: contrato.cre,
            tipo: contrato.tipo,
            modalidade: contrato.modalidade,
            empresa_id: contrato.empresaId,
            periodo_inicial: contrato.periodoInicial,
            periodo_final: contrato.periodoFinal,
            situacao: contrato.situacao,
            gestor: contrato.gestor,
            alunos: contrato.alunos,
            municipio: contrato.municipio,
            valor_diario: contrato.valorDiario,
            valor_km: contrato.valorKm,
            km: contrato.km,
            valor_mensal: contrato.valorMensal,
            postos: contrato.postos,
            anexos: contrato.anexos
        };

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dbData)
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || data.message || 'Erro ao salvar contrato');
        }

        await fetchAllData();
        loadDashboardStats();
    }

    // ==========================================
    // DASHBOARD & GRÁFICOS
    // ==========================================
    let dashboardChart = null;

    function loadDashboardStats() {
        const empresasCount = getEmpresas().length;
        const contratos = getContratos();
        const contratosAtivos = contratos.filter(c => c.situacao === 'Ativo').length;
        const contratosAtivosArray = contratos.filter(c => c.situacao === 'Ativo');
        const contratosGasto = contratosAtivosArray.reduce((sum, c) => sum + (parseFloat(c.valorMensal) || (parseFloat(c.valorDiario) * 22) || 0), 0);
        
        document.getElementById('count-empresas').textContent = empresasCount;
        document.getElementById('count-contratos').textContent = contratosAtivos;
        
        const spanGasto = document.getElementById('count-gasto');
        if(spanGasto) spanGasto.textContent = formatCurrency(contratosGasto);

        const statusVig = document.getElementById('status-vigente');
        const statusFin = document.getElementById('status-finalizado');
        if(statusVig) statusVig.textContent = contratosAtivos;
        if(statusFin) statusFin.textContent = contratos.filter(c => c.situacao && c.situacao !== 'Ativo').length;

        // Render Gráfico
        renderDashboardChart(contratos);

        // Dispara verificador de alertas
        checkAlertasVencimento(contratos);
    }

    function renderDashboardChart(contratos) {
        const canvas = document.getElementById('chart-servicos');
        if(!canvas) return;
        
        // Contagem por Tipo
        const labels = ['Merendeiras', 'Limpeza', 'Vigilância', 'Porteiros', 'Transporte Escolar'];
        const dataMap = { 'Merendeiras':0, 'Limpeza':0, 'Vigilância':0, 'Porteiros':0, 'Transporte Escolar':0 };
        contratos.forEach(c => {
            if(c.situacao === 'Ativo' && dataMap[c.tipo] !== undefined) {
                dataMap[c.tipo]++;
            }
        });
        const dataValues = labels.map(l => dataMap[l]);

        if(dashboardChart) dashboardChart.destroy();
        
        const ctx = canvas.getContext('2d');
        dashboardChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: dataValues,
                    backgroundColor: ['#e63946', '#2a9d8f', '#e9c46a', '#f4a261', '#219ebc'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right', labels: { font: { size: 10 } } }
                }
            }
        });
    }

    function checkAlertasVencimento(contratos) {
        const alertas = [];
        const hoje = new Date();
        let countVencendo = 0;
        
        contratos.forEach(c => {
            if (c.situacao === 'Ativo' && c.periodoFinal) {
                const dataFim = new Date(c.periodoFinal);
                const diffTime = dataFim - hoje;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays <= 90 && diffDays > 0) {
                    countVencendo++;
                    alertas.push({ dias: diffDays, contrato: c.numero, cre: c.cre, servico: c.tipo });
                }
            }
        });
        
        const badge = document.getElementById('notif-badge');
        const list = document.getElementById('notif-list');
        const elCount = document.getElementById('count-vencendo');
        if(elCount) elCount.textContent = countVencendo;

        if (alertas.length > 0 && badge && list) {
            badge.style.display = 'block';
            list.innerHTML = alertas.sort((a,b)=>a.dias-b.dias).map(a => {
                const color = a.dias <= 30 ? 'var(--danger-color)' : 'var(--warning-color)';
                return `<div style="padding: 10px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 10px;">
                    <div style="width: 8px; height: 8px; border-radius: 50%; min-width: 8px; background: ${color};"></div>
                    <div style="flex: 1;">
                        <strong style="font-size: 13px;">Nº ${a.contrato || '-'} (${a.servico})</strong><br>
                        <span style="font-size: 11.5px; color: var(--text-light);">Vence em ${a.dias} dias. CRE: ${a.cre}</span>
                    </div>
                </div>`;
            }).join('');
        } else if (badge && list) {
            badge.style.display = 'none';
            list.innerHTML = `<div style="padding: 10px; text-align: center; color: var(--text-light); font-size: 12px;">Nenhuma notificação nova</div>`;
        }
    }

    // Toggle Dropdown Notificações
    const btnNotif = document.getElementById('btn-notifications');
    const dropdownNotif = document.getElementById('notif-dropdown');
    if (btnNotif && dropdownNotif) {
        btnNotif.onclick = () => {
            dropdownNotif.classList.toggle('form-hidden');
            dropdownNotif.style.display = dropdownNotif.classList.contains('form-hidden') ? 'none' : 'block';
        };
        document.addEventListener('click', (e) => {
            if (!btnNotif.contains(e.target) && !dropdownNotif.contains(e.target)) {
                dropdownNotif.classList.add('form-hidden');
                dropdownNotif.style.display = 'none';
            }
        });
    }

    // ==========================================
    // EMPRESAS LOGIC
    // ==========================================
    const btnNovoEmpresa = document.getElementById('btn-novo-empresa');
    const formEmpresaContainer = document.getElementById('form-empresa-container');
    const btnCancelEmpresa = document.getElementById('btn-cancel-empresa');
    const formEmpresa = document.getElementById('form-empresa');
    let editingEmpresaId = null;

    // Mascaras e Validação CNPJ
    function maskCNPJ(v) {
        v = v.replace(/\D/g, "");
        v = v.replace(/^(\d{2})(\d)/, "$1.$2");
        v = v.replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3");
        v = v.replace(/\.(\d{3})(\d)/, ".$1/$2");
        v = v.replace(/(\d{4})(\d)/, "$1-$2");
        return v.substring(0, 18);
    }

    function maskPhone(v) {
        v = v.replace(/\D/g, "");
        v = v.replace(/^(\d{2})(\d)/g, "($1) $2");
        v = v.replace(/(\d)(\d{4})$/, "$1-$2");
        return v.substring(0, 15);
    }

    function validarCNPJ(cnpj) {
        cnpj = cnpj.replace(/[^\d]+/g, '');
        if (cnpj == '') return false;
        if (cnpj.length != 14) return false;
        if (/^(\d)\1+$/.test(cnpj)) return false;

        let tamanho = cnpj.length - 2;
        let numeros = cnpj.substring(0, tamanho);
        let digitos = cnpj.substring(tamanho);
        let soma = 0;
        let pos = tamanho - 7;
        for (let i = tamanho; i >= 1; i--) {
            soma += numeros.charAt(tamanho - i) * pos--;
            if (pos < 2) pos = 9;
        }
        let resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
        if (resultado != parseInt(digitos.charAt(0))) return false;

        tamanho = tamanho + 1;
        numeros = cnpj.substring(0, tamanho);
        soma = 0;
        pos = tamanho - 7;
        for (let i = tamanho; i >= 1; i--) {
            soma += numeros.charAt(tamanho - i) * pos--;
            if (pos < 2) pos = 9;
        }
        resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
        return resultado == parseInt(digitos.charAt(1));
    }

    document.getElementById('emp-cnpj').addEventListener('input', (e) => {
        e.target.value = maskCNPJ(e.target.value);
    });

    document.getElementById('emp-telefone').addEventListener('input', (e) => {
        e.target.value = maskPhone(e.target.value);
    });

    btnNovoEmpresa.addEventListener('click', () => {
        editingEmpresaId = null;
        formEmpresa.reset();
        formEmpresaContainer.classList.remove('form-hidden');
    });

    btnCancelEmpresa.addEventListener('click', () => {
        formEmpresaContainer.classList.add('form-hidden');
    });

    formEmpresa.addEventListener('submit', async (e) => {
        e.preventDefault();

        const cnpjVal = document.getElementById('emp-cnpj').value;
        if (!validarCNPJ(cnpjVal)) {
            showBeautifulAlert('CNPJ Inválido', 'O CNPJ informado não é válido. Verifique os números e tente novamente.', true);
            return;
        }

        const empresaData = {
            id: editingEmpresaId,
            razao: document.getElementById('emp-razao').value,
            cnpj: cnpjVal,
            email: document.getElementById('emp-email').value,
            telefone: document.getElementById('emp-telefone').value
        };

        try {
            const method = editingEmpresaId ? 'PUT' : 'POST';
            const url = editingEmpresaId ? `${API_URL}/empresas/${editingEmpresaId}` : `${API_URL}/empresas`;
            
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    ...empresaData, 
                    modulo: selectedSystem,
                    userRole: JSON.parse(localStorage.getItem('currentUser'))?.role, 
                    username: JSON.parse(localStorage.getItem('currentUser'))?.usuario 
                })
            });

            const data = await response.json();

            if (response.ok) {
                showToast(editingEmpresaId ? 'Empresa atualizada!' : 'Empresa cadastrada!');
                formEmpresaContainer.classList.add('form-hidden');
                await fetchAllData();
                loadEmpresasTable();
                populateEmpresasSelect();
            } else {
                showBeautifulAlert('Erro ao Salvar', data.message || 'Não foi possível salvar a empresa.', true);
            }
        } catch (error) {
            showBeautifulAlert('Erro de Conexão', 'Não foi possível salvar os dados. Verifique a conexão com o servidor.', true);
        }
    });

    const inputFiltroEmpresaLista = document.getElementById('filtro-empresa-lista');
    if (inputFiltroEmpresaLista) {
        inputFiltroEmpresaLista.addEventListener('input', loadEmpresasTable);
    }

    function loadEmpresasTable() {
        const container = document.getElementById('lista-empresas-card');
        if (!container) return; // Prevent errors if not in view
        
        const searchTerm = (document.getElementById('filtro-empresa-lista')?.value || '').toLowerCase();
        let empresas = getEmpresas();

        if (searchTerm) {
            empresas = empresas.filter(emp => 
                (emp.razao && emp.razao.toLowerCase().includes(searchTerm)) ||
                (emp.cnpj && emp.cnpj.toLowerCase().includes(searchTerm))
            );
        }

        container.innerHTML = '';

        if (empresas.length === 0) {
            container.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-light);">Nenhuma empresa encontrada.</div>`;
            return;
        }

        empresas.forEach((emp, index) => {
            const item = document.createElement('div');
            // Remove full border bottoms or make it very subtle if any. The image shows none or very light.
            const borderBottom = index === empresas.length - 1 ? 'none' : '1px solid var(--border-color)';
            item.style = `display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: ${borderBottom}; background: transparent; font-family: 'Inter', sans-serif;`;

            item.innerHTML = `
                <div style="display: flex; gap: 16px; align-items: flex-start;">
                    <div style="width: 42px; height: 42px; min-width: 42px; border-radius: 50%; background: rgba(37, 99, 235, 0.1); color: var(--primary-color); display: flex; align-items: center; justify-content: center; font-size: 20px; margin-top: 2px;">
                        <i class='bx bx-building'></i>
                    </div>
                    <div style="display: flex; flex-direction: column;">
                        <span style="font-weight: 600; font-size: 14px; color: var(--text-color); margin-bottom: 2px;">${emp.razao || 'Empresa Desconhecida'}</span>
                        <span style="color: var(--text-light); font-size: 12.5px; line-height: 1.5;">CNPJ: ${emp.cnpj || '-'}</span>
                        <span style="color: var(--text-light); font-size: 12.5px; line-height: 1.5;">Email: ${emp.email || '-'}</span>
                        <span style="color: var(--text-light); font-size: 12.5px; line-height: 1.5;">Telefone: ${emp.telefone || '-'}</span>
                    </div>
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <i class='bx bx-edit admin-only' style="font-size: 18px; color: #f59e0b; cursor: pointer;" onclick="editEmpresa('${emp.id}')" title="Editar"></i>
                    <i class='bx bx-trash admin-only' style="font-size: 18px; color: #ef4444; cursor: pointer;" onclick="deleteEmpresa('${emp.id}')" title="Excluir"></i>
                </div>
            `;
            container.appendChild(item);
        });
    }

    window.editEmpresa = function (id) {
        editingEmpresaId = id;
        const empresas = getEmpresas();
        const emp = empresas.find(e => String(e.id) === String(id));
        if (!emp) return;

        document.getElementById('emp-razao').value = emp.razao || '';
        document.getElementById('emp-cnpj').value = emp.cnpj || '';
        document.getElementById('emp-email').value = emp.email || '';
        document.getElementById('emp-telefone').value = emp.telefone || '';

        formEmpresaContainer.classList.remove('form-hidden');
        document.getElementById('empresas').scrollIntoView();
    };

    window.viewEmpresa = function (id) {
        const empresas = getEmpresas();
        const emp = empresas.find(e => String(e.id) === String(id));
        if (!emp) return;

        let html = `
            <div class="detail-section">
                <div class="detail-section-title"><i class='bx bx-building'></i> Dados da Empresa</div>
                <div class="detail-grid">
                    <div class="detail-item">
                        <span class="detail-label">Razão Social</span>
                        <span class="detail-value">${emp.razao || '-'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">CNPJ</span>
                        <span class="detail-value">${emp.cnpj || '-'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">E-mail</span>
                        <span class="detail-value">${emp.email || '-'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Telefone</span>
                        <span class="detail-value">${emp.telefone || '-'}</span>
                    </div>
                </div>
            </div>
        `;

        modalBody.innerHTML = html;
        modalView.classList.remove('form-hidden');
    };

    window.deleteEmpresa = async function (id) {
        if (confirm('Tem certeza que deseja excluir esta empresa?')) {
            try {
                const userObj = JSON.parse(localStorage.getItem('currentUser'));
                const userRole = userObj?.role;
                const username = userObj?.usuario;
                
                const res = await fetch(`${API_URL}/empresas/${id}?userRole=${userRole}&username=${username}`, { method: 'DELETE' });
                const data = await res.json();
                
                if (!res.ok) {
                    if (data.requested) {
                        return showToast(data.message, 'info');
                    }
                    throw new Error(data.error || 'Erro ao excluir empresa');
                }

                // Optimistic UI: Remove from cache immediately
                cachedEmpresas = cachedEmpresas.filter(e => String(e.id) !== String(id));
                loadEmpresasTable();
                populateEmpresasSelect();

                // Small delay to ensure DB consistency before final sync
                await new Promise(r => setTimeout(r, 500));
                await fetchAllData();
                loadEmpresasTable();
                populateEmpresasSelect();
                showToast('Empresa excluída.', 'success');
            } catch (error) {
                console.error('Erro ao excluir empresa:', error);
                let msg = error.message;
                if (msg.includes('perfil Master') || msg.includes('permissão') || msg.includes('Acesso negado')) {
                    msg = 'Acesso negado';
                }
                showToast(msg, 'error');
            }
        }
    }

    function populateEmpresasSelect(selectId) {
        const id = selectId || 'con-empresa';
        const select = document.getElementById(id);
        if (!select) return;
        const empresas = getEmpresas();

        select.innerHTML = '<option value="" disabled selected>Selecione uma Empresa</option>';
        empresas.forEach(emp => {
            const opt = document.createElement('option');
            opt.value = emp.id;
            opt.textContent = emp.razao;
            select.appendChild(opt);
        });
    }

    // ==========================================
    // CONTRATOS LOGIC
    // ==========================================
    const btnNovoContrato = document.getElementById('btn-novo-contrato');
    const formContratoContainer = document.getElementById('form-contrato-container');
    const btnCancelContrato = document.getElementById('btn-cancel-contrato');
    const formContrato = document.getElementById('form-contrato');

    const selectTipo = document.getElementById('con-tipo');
    const grupoServicosGerais = document.getElementById('grupo-servicos-gerais');
    const grupoTransporte = document.getElementById('grupo-transporte');
    const grupoCompartilhado = document.getElementById('grupo-compartilhado');
    const btnSaveContrato = document.getElementById('btn-save-contrato');

    selectTipo.addEventListener('change', (e) => {
        const val = e.target.value;
        grupoCompartilhado.style.display = 'block';
        btnSaveContrato.style.display = 'inline-flex';

        if (val === 'Transporte Escolar') {
            grupoServicosGerais.style.display = 'none';
            grupoTransporte.style.display = 'block';
        } else {
            grupoServicosGerais.style.display = 'block';
            grupoTransporte.style.display = 'none';
        }
    });

    let editingContratoId = null;

    btnNovoContrato.addEventListener('click', () => {
        editingContratoId = null;
        formContrato.reset();
        grupoServicosGerais.style.display = 'none';
        grupoTransporte.style.display = 'none';
        grupoCompartilhado.style.display = 'none';
        // Removed btnSaveContrato.style.display = 'none'; so it's always visible
        btnSaveContrato.style.display = 'inline-flex';
        populateEmpresasSelect(); // Ensure it's updated
        updateContractTypeOptions();
        formContratoContainer.classList.remove('form-hidden');
        const gpAnexos = document.getElementById('grupo-anexos');
        if(gpAnexos) gpAnexos.style.display = 'block';
        document.getElementById('con-anexos').value = '';
        renderAnexosPreview([]);
    });

    btnCancelContrato.addEventListener('click', () => {
        formContratoContainer.classList.add('form-hidden');
    });

    formContrato.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tipo = document.getElementById('con-tipo').value;

        const filesInput = document.getElementById('con-anexos');
        const anexosB64 = [];
        if (filesInput && filesInput.files.length > 0) {
            for (const file of filesInput.files) {
                const b64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result, id: Date.now() + Math.random() });
                    reader.readAsDataURL(file);
                });
                anexosB64.push(b64);
            }
        }

        const existingCon = editingContratoId ? getContratos().find(c => String(c.id) === String(editingContratoId)) : null;
        let finalAnexos = existingCon && existingCon.anexos ? [...existingCon.anexos] : [];
        if(window.anexosToDelete && window.anexosToDelete.length > 0) {
            finalAnexos = finalAnexos.filter(a => !window.anexosToDelete.includes(a.id));
        }
        finalAnexos = [...finalAnexos, ...anexosB64];

        const contratoData = {
            id: editingContratoId,
            numero: document.getElementById('con-numero').value,
            proa: document.getElementById('con-proa').value,
            lote: document.getElementById('con-lote').value,
            cre: document.getElementById('con-cre').value,
            tipo: tipo,
            modalidade: document.getElementById('con-modalidade').value,
            empresaId: document.getElementById('con-empresa').value,
            periodoInicial: document.getElementById('con-periodoinicial').value,
            periodoFinal: document.getElementById('con-periodofinal').value,
            situacao: document.getElementById('con-situacao').value,
            gestor: document.getElementById('con-gestor').value,
            anexos: finalAnexos,
            username: JSON.parse(localStorage.getItem('currentUser'))?.usuario
        };

        if (tipo === 'Transporte Escolar') {
            contratoData.alunos = document.getElementById('con-alunos').value;
            contratoData.municipio = document.getElementById('con-municipio').value;
            contratoData.valorDiario = parseCurrency(document.getElementById('con-valordiario').value);
            contratoData.valorKm = parseCurrency(document.getElementById('con-valorkm').value);
            contratoData.km = parseFloat(document.getElementById('con-km').value) || 0;
        } else {
            contratoData.valorMensal = parseCurrency(document.getElementById('con-valormensal').value);
            contratoData.postos = document.getElementById('con-postos').value;
        }

        try {
            await saveContratos(contratoData, !!editingContratoId);
            showToast(editingContratoId ? 'Contrato atualizado!' : 'Contrato salvo!');
            formContratoContainer.classList.add('form-hidden');
            loadContratosTable();
        } catch (error) {
            showToast(error.message, 'error');
        }
    });

    // Filtros
    const inputsFiltro = [
        'filtro-processo', 'filtro-tipo', 'filtro-cre',
        'filtro-contrato', 'filtro-empresa', 'filtro-situacao', 'filtro-modalidade'
    ].map(id => document.getElementById(id));

    inputsFiltro.forEach(input => {
        if (input) input.addEventListener('input', loadContratosTable);
    });

    document.getElementById('btn-limpar-filtros').addEventListener('click', () => {
        inputsFiltro.forEach(input => { if (input) input.value = ''; });
        loadContratosTable();
    });

    function loadContratosTable() {
        const tbody = document.getElementById('lista-contratos');
        let contratos = getContratos();
        const empresas = getEmpresas();

        // Aplicar filtros
        contratos = contratos.filter(con => {
            const emp = empresas.find(e => String(e.id) === String(con.empresaId));
            const empName = emp ? emp.razao.toLowerCase() : '';

            const vPro = (document.getElementById('filtro-processo').value || '').toLowerCase();
            const matchProcesso = con.proa ? con.proa.toLowerCase().includes(vPro) : (vPro === '' || true); // always evaluate
            if (vPro && (!con.proa || !con.proa.toLowerCase().includes(vPro))) return false;

            const vTip = (document.getElementById('filtro-tipo').value || '').toLowerCase();
            if (vTip && (!con.tipo || !con.tipo.toLowerCase().includes(vTip))) return false;

            const vCre = (document.getElementById('filtro-cre').value || '').toLowerCase();
            if (vCre && (!con.cre || !con.cre.toLowerCase().includes(vCre))) return false;

            const vNum = (document.getElementById('filtro-contrato').value || '').toLowerCase();
            if (vNum && (!con.numero || !con.numero.toLowerCase().includes(vNum))) return false;

            const vEmp = (document.getElementById('filtro-empresa').value || '').toLowerCase();
            if (vEmp && !empName.includes(vEmp)) return false;

            const vSit = document.getElementById('filtro-situacao').value;
            if (vSit && con.situacao !== vSit) return false;

            const vMod = document.getElementById('filtro-modalidade').value;
            if (vMod && con.modalidade !== vMod) return false;

            return true;
        });

        tbody.innerHTML = '';

        if (contratos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-light)">Nenhum contrato encontrado.</td></tr>`;
            return;
        }

        contratos.forEach(con => {
            const emp = empresas.find(e => String(e.id) === String(con.empresaId));
            const empName = emp ? emp.razao : '<span style="color:red">Empresa Excluída</span>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${con.numero || '-'}</td>
                <td>${empName}</td>
                <td>${con.tipo || '-'}</td>
                <td>${con.cre || '-'}</td>
                <td><span class="badge ${con.situacao || ''}">${con.situacao || '-'}</span></td>
                <td>
                    <button class="btn-icon" onclick="viewContrato('${con.id}')" title="Visualizar"><i class='bx bx-show'></i></button>
                    <button class="btn-icon admin-only" onclick="editContrato('${con.id}')" title="Editar"><i class='bx bx-pencil'></i></button>
                    <button class="btn-icon" style="color: #fca311; background: rgba(252,163,17,0.15);" onclick="openAnexosContrato('${con.id}')" title="Anexos"><i class='bx bx-paperclip'></i></button>
                    <button class="btn-icon delete admin-only" onclick="deleteContrato('${con.id}')" title="Excluir"><i class='bx bx-trash'></i></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    window.deleteContrato = async function (id) {
        if (confirm('Tem certeza que deseja excluir permanentemente este contrato?')) {
            try {
                const userObj = JSON.parse(localStorage.getItem('currentUser'));
                const userRole = userObj?.role;
                const username = userObj?.usuario;
                
                const res = await fetch(`${API_URL}/contratos/${id}?userRole=${userRole}&username=${username}`, { method: 'DELETE' });
                const data = await res.json();
                
                if (!res.ok) {
                    if (data.requested) {
                        return showToast(data.message, 'info');
                    }
                    throw new Error(data.error || 'Erro ao excluir contrato');
                }

                // Optimistic UI: Remove from cache immediately
                cachedContratos = cachedContratos.filter(c => String(c.id) !== String(id));
                loadContratosTable();

                // Small delay to ensure DB consistency before final sync
                await new Promise(r => setTimeout(r, 500));
                await fetchAllData();
                loadContratosTable();
                showToast('Contrato excluído com sucesso');
            } catch (error) {
                console.error('Erro ao excluir contrato:', error);
                let msg = error.message;
                if (msg.includes('perfil Master') || msg.includes('permissão') || msg.includes('Acesso negado')) {
                    msg = 'Acesso negado';
                }
                showToast(msg, 'error');
            }
        }
    }

    // Modal View & Edit Logic
    window.editContrato = function (id) {
        editingContratoId = id;
        const contratos = getContratos();
        const con = contratos.find(c => String(c.id) === String(id));
        if (!con) return;

        populateEmpresasSelect();

        document.getElementById('con-numero').value = con.numero || '';
        document.getElementById('con-proa').value = con.proa || '';
        document.getElementById('con-lote').value = con.lote || '';
        document.getElementById('con-cre').value = con.cre || '';
        document.getElementById('con-tipo').value = con.tipo || '';
        document.getElementById('con-modalidade').value = con.modalidade || '';
        document.getElementById('con-empresa').value = con.empresaId || '';

        document.getElementById('con-periodoinicial').value = con.periodoInicial || '';
        document.getElementById('con-periodofinal').value = con.periodoFinal || '';
        document.getElementById('con-situacao').value = con.situacao || '';
        document.getElementById('con-gestor').value = con.gestor || '';

        if (con.tipo === 'Transporte Escolar') {
            document.getElementById('con-alunos').value = con.alunos || '';
            document.getElementById('con-municipio').value = con.municipio || '';
            
            const vD = document.getElementById('con-valordiario');
            vD.value = formatCurrency(con.valorDiario);
            const vK = document.getElementById('con-valorkm');
            vK.value = formatCurrency(con.valorKm);

            document.getElementById('con-km').value = con.km || '';
        } else if (con.tipo) {
            const vM = document.getElementById('con-valormensal');
            vM.value = formatCurrency(con.valorMensal);
            document.getElementById('con-postos').value = con.postos || '';
        }

        // Trigger visual change
        selectTipo.dispatchEvent(new Event('change'));

        document.getElementById('grupo-anexos').style.display = 'block';
        document.getElementById('con-anexos').value = '';
        window.anexosToDelete = [];
        renderAnexosPreview(con.anexos || []);

        formContratoContainer.classList.remove('form-hidden');
        document.getElementById('contratos').scrollIntoView();
    };

    const modalView = document.getElementById('generic-modal');
    const modalBody = document.getElementById('modal-body');
    const btnCloseModal = document.getElementById('btn-close-modal');

    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', () => {
            modalView.classList.add('form-hidden');
        });
    }

    window.viewContrato = function (id) {
        const contratos = getContratos();
        const con = contratos.find(c => String(c.id) === String(id));
        if (!con) return;
        const empresas = getEmpresas();
        const emp = empresas.find(e => String(e.id) === String(con.empresaId));

        const pIni = con.periodoInicial ? con.periodoInicial.split('-').reverse().join('/') : '-';
        const pFin = con.periodoFinal ? con.periodoFinal.split('-').reverse().join('/') : '-';

        let html = `
            <!-- Seção 1: Identificação -->
            <div class="detail-section">
                <div class="detail-section-title"><i class='bx bx-info-circle'></i> Informações Gerais</div>
                <div class="detail-grid">
                    <div class="detail-item">
                        <span class="detail-label">Número do Contrato</span>
                        <span class="detail-value">${con.numero || '-'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Empresa</span>
                        <span class="detail-value">${emp ? emp.razao : 'Desconhecida'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Tipo de Serviço</span>
                        <span class="detail-value">${con.tipo || '-'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Tipo de Contrato</span>
                        <span class="detail-value">${con.modalidade || '-'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">PROA</span>
                        <span class="detail-value">${con.proa || '-'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Lote</span>
                        <span class="detail-value">${con.lote || '-'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">CRE</span>
                        <span class="detail-value">${con.cre || '-'}</span>
                    </div>
                </div>
            </div>

            <!-- Seção 2: Financeiro e Operacional -->
            <div class="detail-section">
                <div class="detail-section-title"><i class='bx bx-dollar-circle'></i> Valores e Postos</div>
                <div class="detail-grid">
                    ${con.tipo === 'Transporte Escolar' ? `
                        <div class="detail-item"><span class="detail-label">Alunos</span><span class="detail-value">${con.alunos || '-'}</span></div>
                        <div class="detail-item"><span class="detail-label">Município</span><span class="detail-value">${con.municipio || '-'}</span></div>
                        <div class="detail-item"><span class="detail-label">Valor Diário</span><span class="detail-value">${formatCurrency(con.valorDiario)}</span></div>
                        <div class="detail-item"><span class="detail-label">Valor do KM</span><span class="detail-value">${formatCurrency(con.valorKm)}</span></div>
                        <div class="detail-item"><span class="detail-label">Quilometragem (KM)</span><span class="detail-value">${con.km || '-'}</span></div>
                    ` : `
                        <div class="detail-item"><span class="detail-label">Valor Mensal</span><span class="detail-value">${formatCurrency(con.valorMensal)}</span></div>
                        <div class="detail-item"><span class="detail-label">Postos</span><span class="detail-value">${con.postos || '-'}</span></div>
                    `}
                </div>
            </div>

            <!-- Seção 3: Vigência e Gestão -->
            <div class="detail-section">
                <div class="detail-section-title"><i class='bx bx-calendar-check'></i> Vigência e Gestão</div>
                <div class="detail-grid">
                    <div class="detail-item">
                        <span class="detail-label">Início de Vigência</span>
                        <span class="detail-value">${pIni}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Término de Vigência</span>
                        <span class="detail-value">${pFin}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Situação</span>
                        <span class="detail-value" style="color: ${con.situacao === 'Ativo' ? 'var(--success-color)' : 'var(--danger-color)'}">${con.situacao || '-'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Gestor</span>
                        <span class="detail-value">${con.gestor || '-'}</span>
                    </div>
                </div>
            </div>
        `;

        modalBody.innerHTML = html;
        modalView.classList.remove('form-hidden');
    };

    window.renderAnexosPreview = function(anexos) {
        const preview = document.getElementById('anexos-preview');
        preview.innerHTML = '';
        if(anexos.length === 0) return;
        
        anexos.forEach(a => {
            if(window.anexosToDelete && window.anexosToDelete.includes(a.id)) return;
            const div = document.createElement('div');
            div.style = "display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px;";
            div.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i class='bx bx-file' style="color: var(--primary-color);"></i>
                    <span style="max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${a.name}">${a.name}</span>
                </div>
                <button type="button" class="btn-icon delete" style="padding: 2px;" onclick="window.anexosToDelete.push(${a.id}); renderAnexosPreview(${JSON.stringify(anexos).replace(/"/g, '&quot;')})">
                    <i class='bx bx-trash' style="font-size: 14px;"></i>
                </button>
            `;
            preview.appendChild(div);
        });
    };

    window.openAnexosContrato = function(id) {
        const con = getContratos().find(c => String(c.id) === String(id));
        if(!con) return;

        const modalAnexos = document.getElementById('modal-anexos');
        const container = document.getElementById('anexos-list-container');
        document.getElementById('modal-anexos-title').textContent = `Anexos - Contrato ${con.numero}`;
        
        container.innerHTML = '';
        const anexos = con.anexos || [];
        
        if (anexos.length === 0) {
            container.innerHTML = '<div id="empty-anexos" style="text-align: center; color: var(--text-light); padding: 40px 0;">Nenhum anexo encontrado.</div>';
        } else {
            anexos.forEach(a => {
                const el = document.createElement('div');
                el.style = "display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 6px;";
                el.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 36px; height: 36px; border-radius: 6px; background: rgba(67, 97, 238, 0.1); color: var(--primary-color); display: flex; align-items: center; justify-content: center; font-size: 20px;">
                            <i class='bx bx-file'></i>
                        </div>
                        <div>
                            <div style="font-size: 14px; font-weight: 500; color: var(--text-color);">${a.name}</div>
                            <div style="font-size: 11px; color: var(--text-light);">Arquivo anexado</div>
                        </div>
                    </div>
                    <button type="button" onclick="visualizarAnexo('${a.data}', '${a.name}')" class="btn btn-primary" style="padding: 6px 12px; font-size: 12px; display: flex; align-items: center; gap: 5px;">
                        <i class='bx bx-show'></i> Visualizar
                    </button>
                `;
                container.appendChild(el);
            });
        }
        modalAnexos.classList.remove('form-hidden');
    };

    const clsAnexos = () => document.getElementById('modal-anexos').classList.add('form-hidden');
    document.getElementById('btn-close-anexos-modal')?.addEventListener('click', clsAnexos);
    document.getElementById('btn-fechar-anexos')?.addEventListener('click', clsAnexos);

    window.visualizarAnexo = function(base64, filename) {
        try {
            const arr = base64.split(',');
            const mime = arr[0].match(/:(.*?);/)[1];
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while(n--) {
                u8arr[n] = bstr.charCodeAt(n);
            }
            const blob = new Blob([u8arr], {type: mime});
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            // Remove the URL after 1 minute to free memory
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (e) {
            console.error("Erro ao gerar visualização do anexo", e);
            // Fallback para download se der erro
            const link = document.createElement('a');
            link.href = base64;
            link.download = filename || 'anexo';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };



    const subLinks = document.querySelectorAll('#submenu-faturamentos a, #submenu-postos a');
    subLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('data-target');
            const servico = link.getAttribute('data-servico');
            const label = link.textContent;
            
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
            const targetView = document.getElementById(targetId);
            if (targetView) targetView.classList.add('active-view');
            
            document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
            const menuFat = document.getElementById('menu-faturamentos');
            if (menuFat) menuFat.classList.add('active');

            if (targetId === 'faturamentos-lista') {
                document.getElementById('fat-group-title').textContent = `Faturamentos - ${label}`;
                document.getElementById('filtro-fat-empresa').value = ''; // Limpar filtro ao trocar setor
                loadContratosFaturamentosTable(servico);
            } else if (targetId === 'postos-lista') {
                document.getElementById('postos-group-title').textContent = `Gerenciamento de Postos - ${label}`;
                
                // Clear filters
                document.getElementById('filter-postos-cre').value = "";
                document.getElementById('filter-postos-empresa').value = "";
                document.getElementById('filter-postos-municipio').value = "";
                
                loadPostosDashboard(servico);
            }
        });
    });

    let currentFatServico = null;
    const fatEmpresaFilter = document.getElementById('filtro-fat-empresa');
    if (fatEmpresaFilter) {
        fatEmpresaFilter.addEventListener('input', () => {
            if (currentFatServico) loadContratosFaturamentosTable(currentFatServico);
        });
    }

    function loadContratosFaturamentosTable(servico) {
        currentFatServico = servico;
        const tbody = document.getElementById('lista-contratos-faturamentos');
        const searchEmp = (document.getElementById('filtro-fat-empresa').value || '').toLowerCase();
        
        const empresas = getEmpresas();
        let contratos = getContratos().filter(c => c.tipo === servico);

        // Filtrar por empresa
        if (searchEmp) {
            contratos = contratos.filter(con => {
                const emp = empresas.find(e => String(e.id) === String(con.empresaId));
                return emp ? emp.razao.toLowerCase().includes(searchEmp) : false;
            });
        }

        tbody.innerHTML = '';
        if (contratos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--text-light)">Nenhum contrato encontrado.</td></tr>`;
            return;
        }

        contratos.forEach(con => {
            const emp = empresas.find(e => String(e.id) === String(con.empresaId));
            const empName = emp ? emp.razao : '<span style="color:red">Desconhecida</span>';
            const vigencia = `${con.periodoInicial ? con.periodoInicial.split('-').reverse().join('/') : '-'} á ${con.periodoFinal ? con.periodoFinal.split('-').reverse().join('/') : '-'}`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${con.numero || '-'}</td>
                <td>${empName}</td>
                <td>${vigencia}</td>
                <td>
                    <button class="btn btn-secondary" onclick="openModalFaturamentos('${con.id}', '${con.numero}')" style="font-size:12px; padding: 6px 12px; background: transparent; border: 1px solid var(--primary-color); color: var(--primary-color);">
                        <i class='bx bx-edit'></i> Gerenciar Faturamentos
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    const modalFat = document.getElementById('modal-faturamentos');
    const btnCloseFat = document.getElementById('btn-close-fat-modal');
    const btnCancelFat = document.getElementById('btn-cancel-fat');
    const btnSaveFat = document.getElementById('btn-save-fat');
    
    let currentFatContratoId = null;
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    async function getDbFatFromServer(ano) {
        try {
            const res = await fetch(`${API_URL}/faturamentos?ano=${ano}`);
            const data = await res.json();
            let dbFat = {};
            for (const item of data) {
                dbFat[item.contrato_id] = JSON.parse(item.dados);
            }
            return dbFat;
        } catch(e) {
            console.error(e);
            return {};
        }
    }

    window.openModalFaturamentos = async function(contratoId, contratoNumero) {
        currentFatContratoId = contratoId;
        window.currentFatAnexos = {}; // Inicializa o estado dos anexos na memória
        const ano = document.getElementById('select-ano-fat') ? document.getElementById('select-ano-fat').value : '2025';
        document.getElementById('modal-fat-title').textContent = `Gerenciar Faturamentos ${ano} - Contrato ${contratoNumero}`;
        
        let dbFat = await getDbFatFromServer(ano);
        let fatList = dbFat[contratoId] || Array(12).fill({});

        const tbody = document.getElementById('fat-grid-body');
        tbody.innerHTML = '';

        const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
        const roleDisabled = user.role === 'usuario';

        const con = getContratos().find(c => String(c.id) === String(contratoId));
        const isTransporte = con && con.tipo === 'Transporte Escolar';

        const fatModalContent = document.getElementById('modal-content-fat');
        const fatTable = document.getElementById('fat-planilha-table');

        if (fatModalContent && fatTable) {
            if (isTransporte) {
                fatModalContent.style.width = '95vw';
                fatModalContent.style.maxWidth = '1500px';
                fatTable.style.minWidth = '1450px';
            } else {
                fatModalContent.style.width = '90vw';
                fatModalContent.style.maxWidth = '950px';
                fatTable.style.minWidth = '860px';
            }
        }

        // Update Table Header
        const thead = document.getElementById('fat-thead');
        if (thead) {
            if (isTransporte) {
                thead.innerHTML = `
                    <tr>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 100px;">MÊS</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 160px;">Nº PROCESSO</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 100px;">GEO</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 100px;">KM</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 120px;">VALOR KM</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 120px;">VALOR DIÁRIO</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 80px;">DIAS</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 120px;">SITUAÇÃO</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 160px;">DATA PAGAMENTO</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 150px;">VALOR PAGO (R$)</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: center; border-bottom: 2px solid var(--border-color); width: 80px;">ANEXOS</th>
                    </tr>`;
            } else {
                thead.innerHTML = `
                    <tr>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 100px;">MÊS</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 160px;">Nº PROCESSO</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 160px;">DATA ABERTURA</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 130px;">SITUAÇÃO</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 160px;">DATA PAGAMENTO</th>
                        <th style="padding: 15px; font-size: 11px; color: var(--text-light); text-transform: uppercase; text-align: left; border-bottom: 2px solid var(--border-color); width: 150px;">VALOR PAGO (R$)</th>
                    </tr>`;
            }
        }

        months.forEach((m, idx) => {
            const data = fatList[idx] || {};
            window.currentFatAnexos[idx] = data.anexos ? [...data.anexos] : [];
            
            let inRange = true;
            if (con && con.periodoInicial && con.periodoFinal) {
                const inicio = new Date(con.periodoInicial + 'T00:00:00');
                const fim = new Date(con.periodoFinal + 'T00:00:00');
                const startYearMonth = inicio.getFullYear() * 12 + inicio.getMonth();
                const endYearMonth = fim.getFullYear() * 12 + fim.getMonth();
                const currentYearMonth = parseInt(ano) * 12 + idx;
                
                inRange = (currentYearMonth >= startYearMonth && currentYearMonth <= endYearMonth);
            }
            
            const fieldDisabled = (roleDisabled || !inRange) ? 'disabled' : '';
            const rowStyle = !inRange ? 'background: rgba(0,0,0,0.02); opacity: 0.6;' : '';
            
            const tr = document.createElement('tr');
            if(!inRange) tr.title = "Fora do período de vigência do contrato";
            tr.style = rowStyle;

            if (isTransporte) {
                tr.innerHTML = `
                    <td style="padding: 8px 12px; font-weight: 500; font-size: 13px; border-bottom: 1px solid var(--border-color);">${m}</td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color);">
                        <input type="text" id="fat-proc-${idx}" value="${data.processo || ''}" class="fat-input" style="background: transparent;" ${fieldDisabled}>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color);">
                        <input type="text" id="fat-geo-${idx}" value="${data.geo || ''}" class="fat-input" style="background: transparent;" ${fieldDisabled}>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color);">
                        <input type="text" id="fat-km-${idx}" value="${data.km || ''}" placeholder="0" class="fat-input" style="background: transparent;" ${fieldDisabled}>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color);">
                        <input type="text" id="fat-valkm-${idx}" value="${formatCurrency(data.valorKm)}" placeholder="R$ 0,00" class="fat-input" style="background: transparent;" ${fieldDisabled}>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color);">
                        <input type="text" id="fat-valdia-${idx}" value="${formatCurrency(data.valorDiario)}" placeholder="R$ 0,00" class="fat-input" style="background: transparent;" ${fieldDisabled}>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color);">
                        <input type="number" id="fat-dias-${idx}" value="${data.dias || ''}" placeholder="0" class="fat-input" style="background: transparent;" ${fieldDisabled}>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color);">
                        <select id="fat-sit-${idx}" class="fat-input fat-select" ${fieldDisabled}>
                            <option value="Pendente" ${data.situacao === 'Pendente' ? 'selected' : ''}>Pendente</option>
                            <option value="Pago" ${data.situacao === 'Pago' ? 'selected' : ''}>Pago</option>
                            <option value="Retido" ${data.situacao === 'Retido' ? 'selected' : ''}>Retido</option>
                        </select>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color);">
                        <input type="date" id="fat-pag-${idx}" value="${data.pagamento || ''}" class="fat-input" style="background: transparent;" ${fieldDisabled}>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color);">
                        <input type="text" id="fat-val-${idx}" value="${formatCurrency(data.valor)}" placeholder="R$ 0,00" class="fat-input" style="background: transparent;" ${fieldDisabled}>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color); text-align: center; position: relative;">
                        <button type="button" class="btn-icon" title="Anexos" onclick="openFatAnexosModal(${idx}, '${m}')" style="color: var(--primary-color); padding: 5px;">
                            <i class='bx bx-paperclip' style="font-size: 20px;"></i>
                            <span id="fat-anexo-badge-${idx}" style="font-size: 10px; background: #e63946; color: #fff; border-radius: 50%; padding: 2px 5px; position: absolute; top: 0px; right: 2px; font-weight: bold; ${window.currentFatAnexos[idx].length > 0 ? '' : 'display: none;'}">${window.currentFatAnexos[idx].length}</span>
                        </button>
                    </td>
                `;
            } else {
                tr.innerHTML = `
                    <td style="padding: 8px 12px; font-weight: 500; font-size: 13px; border-bottom: 1px solid var(--border-color);">${m}</td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color);">
                        <input type="text" id="fat-proc-${idx}" value="${data.processo || ''}" class="fat-input" style="background: transparent;" ${fieldDisabled}>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color);">
                        <input type="date" id="fat-abert-${idx}" value="${data.abertura || ''}" class="fat-input" style="background: transparent;" ${fieldDisabled}>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color);">
                        <select id="fat-sit-${idx}" class="fat-input fat-select" ${fieldDisabled}>
                            <option value="Pendente" ${data.situacao === 'Pendente' ? 'selected' : ''}>Pendente</option>
                            <option value="Pago" ${data.situacao === 'Pago' ? 'selected' : ''}>Pago</option>
                            <option value="Retido" ${data.situacao === 'Retido' ? 'selected' : ''}>Retido</option>
                        </select>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color);">
                        <input type="date" id="fat-pag-${idx}" value="${data.pagamento || ''}" class="fat-input" style="background: transparent;" ${fieldDisabled}>
                    </td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid var(--border-color);">
                        <input type="text" id="fat-val-${idx}" value="${formatCurrency(data.valor)}" placeholder="R$ 0,00" class="fat-input" style="background: transparent;" ${fieldDisabled}>
                    </td>
                `;
            }
            tbody.appendChild(tr);

            // Add masks to dynamic currency inputs
            if (isTransporte) {
                const vkInput = tr.querySelector(`#fat-valkm-${idx}`);
                const vdInput = tr.querySelector(`#fat-valdia-${idx}`);
                if(vkInput) vkInput.addEventListener('input', maskCurrency);
                if(vdInput) vdInput.addEventListener('input', maskCurrency);
            }
            const fatInput = tr.querySelector(`#fat-val-${idx}`);
            if(fatInput) fatInput.addEventListener('input', maskCurrency);
        });

        modalFat.classList.remove('form-hidden');
    }

    const closeModalFat = () => modalFat.classList.add('form-hidden');
    
    if (btnCloseFat) btnCloseFat.addEventListener('click', closeModalFat);
    if (btnCancelFat) btnCancelFat.addEventListener('click', closeModalFat);

    if (btnSaveFat) {
        btnSaveFat.addEventListener('click', async () => {
            if (!currentFatContratoId) return;

            const con = getContratos().find(c => String(c.id) === String(currentFatContratoId));
            const isTransporte = con && con.tipo === 'Transporte Escolar';

            let fatArray = [];
            for (let i = 0; i < 12; i++) {
                const item = {
                    processo: document.getElementById(`fat-proc-${i}`).value,
                    situacao: document.getElementById(`fat-sit-${i}`).value,
                    pagamento: document.getElementById(`fat-pag-${i}`).value,
                    valor: parseCurrency(document.getElementById(`fat-val-${i}`).value)
                };

                if (isTransporte) {
                    item.geo = document.getElementById(`fat-geo-${i}`).value;
                    item.km = document.getElementById(`fat-km-${i}`).value;
                    item.valorKm = parseCurrency(document.getElementById(`fat-valkm-${i}`).value);
                    item.valorDiario = parseCurrency(document.getElementById(`fat-valdia-${i}`).value);
                    item.dias = document.getElementById(`fat-dias-${i}`).value;
                    item.anexos = window.currentFatAnexos[i] || [];
                } else {
                    item.abertura = document.getElementById(`fat-abert-${i}`).value;
                }
                
                fatArray.push(item);
            }

            const ano = document.getElementById('select-ano-fat') ? document.getElementById('select-ano-fat').value : '2025';
            
            try {
                const res = await fetch(`${API_URL}/faturamentos`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        ano: parseInt(ano), 
                        contratoId: parseInt(currentFatContratoId), 
                        dados: fatArray 
                    })
                });
                
                if (res.ok) {
                    showToast('Faturamentos salvos com sucesso!');
                    closeModalFat();
                } else {
                    const errorData = await res.json();
                    console.error('Erro no servidor:', errorData);
                    let displayMsg = errorData.error || (typeof errorData === 'object' ? JSON.stringify(errorData) : errorData);
                    showToast(`Erro ao salvar: ${displayMsg}`, 'error');
                }
            } catch(e) {
                console.error(e);
                showToast('Falha na conexão ao salvar faturamentos.', 'error');
            }
        });
    }

    // ==========================================
    // LÓGICA DE ANEXOS DO FATURAMENTO
    // ==========================================
    let currentFatAnexoMonthIdx = null;
    const modalFatAnexos = document.getElementById('modal-fat-anexos');
    const btnCloseFatAnexos = document.getElementById('btn-close-fat-anexos-modal');
    const btnFecharFatAnexos = document.getElementById('btn-fechar-fat-anexos');
    const fatAnexosInput = document.getElementById('fat-anexos-input');

    window.openFatAnexosModal = function(idx, monthName) {
        currentFatAnexoMonthIdx = idx;
        document.getElementById('modal-fat-anexos-title').textContent = `Anexos - ${monthName}`;
        fatAnexosInput.value = ''; // Reseta o input

        const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
        const roleDisabled = user.role === 'usuario';
        
        const uploadArea = document.getElementById('fat-anexos-upload-area');
        if (uploadArea) {
            uploadArea.style.display = roleDisabled ? 'none' : 'block';
        }

        renderFatAnexosList();
        modalFatAnexos.classList.remove('form-hidden');
    };

    function renderFatAnexosList() {
        const container = document.getElementById('fat-anexos-list-container');
        container.innerHTML = '';
        const anexos = window.currentFatAnexos[currentFatAnexoMonthIdx] || [];
        
        const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
        const roleDisabled = user.role === 'usuario';

        if (anexos.length === 0) {
            container.innerHTML = '<div id="empty-fat-anexos" style="text-align: center; color: var(--text-light); padding: 40px 0;">Nenhum anexo lançado neste mês.</div>';
        } else {
            anexos.forEach(a => {
                const el = document.createElement('div');
                el.style = "display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 6px;";
                el.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 36px; height: 36px; border-radius: 6px; background: rgba(67, 97, 238, 0.1); color: var(--primary-color); display: flex; align-items: center; justify-content: center; font-size: 20px;">
                            <i class='bx bx-file'></i>
                        </div>
                        <div>
                            <div style="font-size: 14px; font-weight: 500; color: var(--text-color); max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${a.name}">${a.name}</div>
                            <div style="font-size: 11px; color: var(--text-light);">Arquivo anexado</div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" onclick="visualizarAnexo('${a.data}', '${a.name}')" class="btn btn-primary" style="padding: 6px 10px; font-size: 12px; display: flex; align-items: center; gap: 5px;">
                            <i class='bx bx-show'></i>
                        </button>
                        ${roleDisabled ? '' : `<button type="button" onclick="removeFatAnexo(${a.id})" class="btn-icon delete" style="padding: 6px 10px; font-size: 12px; background: #fee2e2; color: #e63946; border-radius: 4px; display: flex; align-items: center;">
                            <i class='bx bx-trash'></i>
                        </button>`}
                    </div>
                `;
                container.appendChild(el);
            });
        }
        
        // Update badge na tabela
        const badge = document.getElementById(`fat-anexo-badge-${currentFatAnexoMonthIdx}`);
        if(badge) {
            badge.textContent = anexos.length;
            badge.style.display = anexos.length > 0 ? 'inline-block' : 'none';
        }
    }

    window.removeFatAnexo = function(id) {
        if(currentFatAnexoMonthIdx === null) return;
        window.currentFatAnexos[currentFatAnexoMonthIdx] = window.currentFatAnexos[currentFatAnexoMonthIdx].filter(a => a.id !== id);
        renderFatAnexosList();
    };

    if (fatAnexosInput) {
        fatAnexosInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0 || currentFatAnexoMonthIdx === null) return;
            
            for (const file of files) {
                const b64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result, id: Date.now() + Math.random() });
                    reader.readAsDataURL(file);
                });
                if(!window.currentFatAnexos[currentFatAnexoMonthIdx]) {
                    window.currentFatAnexos[currentFatAnexoMonthIdx] = [];
                }
                window.currentFatAnexos[currentFatAnexoMonthIdx].push(b64);
            }
            renderFatAnexosList();
            fatAnexosInput.value = ''; // limpa input para permitir o mesmo arquivo se deletado
        });
    }

    const clsFatAnexos = () => modalFatAnexos.classList.add('form-hidden');
    if (btnCloseFatAnexos) btnCloseFatAnexos.addEventListener('click', clsFatAnexos);
    if (btnFecharFatAnexos) btnFecharFatAnexos.addEventListener('click', clsFatAnexos);

    // ==========================================
    // POSTOS LOGIC
    // ==========================================
    let currentPostoServico = null;
    
    const postosCreFilter = document.getElementById('filter-postos-cre');
    const postosEmpresaFilter = document.getElementById('filter-postos-empresa');
    const postosMunicipioFilter = document.getElementById('filter-postos-municipio');
    const postosEscolaFilter = document.getElementById('filter-postos-escola');
    const btnLimparFiltrosPostos = document.getElementById('btn-limpar-filtros-postos');
    
    [postosCreFilter, postosEmpresaFilter, postosMunicipioFilter, postosEscolaFilter].forEach(el => {
        if(el) el.addEventListener('input', () => loadPostosDashboard());
    });
    
    if(btnLimparFiltrosPostos) {
        btnLimparFiltrosPostos.addEventListener('click', () => {
            postosCreFilter.value = "";
            postosEmpresaFilter.value = "";
            postosMunicipioFilter.value = "";
            postosEscolaFilter.value = "";
            loadPostosDashboard();
        });
    }

    function loadPostosDashboard(servico) {
        if (servico) currentPostoServico = servico;
        if (!currentPostoServico) return;

        const container = document.getElementById('container-postos-cards');
        const allEmpresas = getEmpresas();
        let listContratos = getContratos().filter(c => c.tipo === currentPostoServico && c.situacao === 'Ativo');

        // Atualizar options do Filtro de Empresa com as empresas deste serviço
        const uniqueEmpIds = [...new Set(listContratos.map(c => c.empresaId))];
        const prevEmpVal = postosEmpresaFilter.value;
        postosEmpresaFilter.innerHTML = '<option value="">Todas</option>';
        uniqueEmpIds.forEach(id => {
            const e = allEmpresas.find(emp => emp.id === id);
            if (e) {
                postosEmpresaFilter.innerHTML += `<option value="${e.id}">${e.razao}</option>`;
            }
        });
        postosEmpresaFilter.value = uniqueEmpIds.includes(prevEmpVal) ? prevEmpVal : "";

        // Atualizar options do Filtro de CRE com as CREs deste serviço
        const uniqueCres = [...new Set(listContratos.map(c => c.cre).filter(c => c))];
        const prevCreVal = postosCreFilter.value;
        postosCreFilter.innerHTML = '<option value="">Todas</option>';
        uniqueCres.sort((a, b) => {
            const numA = parseInt((a || "").replace(/\D/g, ''), 10) || 0;
            const numB = parseInt((b || "").replace(/\D/g, ''), 10) || 0;
            return numA - numB;
        }).forEach(cre => {
            postosCreFilter.innerHTML += `<option value="${cre}">${cre.toUpperCase().includes('CRE') ? cre : 'CRE ' + cre}</option>`;
        });
        postosCreFilter.value = uniqueCres.includes(prevCreVal) ? prevCreVal : "";

        // Global dashboard metrics
        let gTotalPostos = 0;
        let gImplantados = 0;
        let gVagos = 0;
        let gEscolas = 0;

        // Apply filters
        const fCre = postosCreFilter.value;
        const fEmp = postosEmpresaFilter.value;
        const fMun = postosMunicipioFilter.value.toLowerCase();
        const fEsc = postosEscolaFilter.value.toLowerCase();

        listContratos.forEach(con => {
            gTotalPostos += parseInt(con.postos || 0);
            
            const escolasDoContrato = cachedPostos.filter(p => p.contrato_id == con.id);
            gEscolas += escolasDoContrato.length;
            
            escolasDoContrato.forEach(esc => {
                gImplantados += parseInt(esc.implantados || 0);
                gVagos += parseInt(esc.vagos || 0);
            });
        });
        
        // Render Top Cards
        document.getElementById('card-total-postos').textContent = gTotalPostos;
        document.getElementById('card-postos-implantados').textContent = gImplantados;
        document.getElementById('card-postos-vagos').textContent = gVagos;
        document.getElementById('card-total-escolas').textContent = gEscolas;

        listContratos = listContratos.filter(c => {
            if (fCre && c.cre !== fCre) return false;
            if (fEmp && c.empresaId !== fEmp) return false;
            
            const escolasArr = cachedPostos.filter(p => p.contrato_id == c.id);

            if (fMun) {
                const checkMun = escolasArr.some(esc => (esc.municipio || '').toLowerCase().includes(fMun));
                if (!checkMun) return false;
            }

            if (fEsc) {
                const checkEsc = escolasArr.some(esc => (esc.nome || '').toLowerCase().includes(fEsc));
                if (!checkEsc) return false;
            }

            return true;
        });

        container.innerHTML = '';

        if (listContratos.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding: 40px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: var(--radius); color: var(--text-light);">Nenhum contrato encontrado para o tipo de serviço com os filtros aplicados.</div>`;
            return;
        }

        listContratos.forEach(con => {
            const emp = allEmpresas.find(e => e.id === con.empresaId);
            const empName = emp ? emp.razao : 'Desconhecida';
            
            const arrEscolas = cachedPostos.filter(p => p.contrato_id == con.id);
            let totalEscolas = arrEscolas.length;
            let imp = 0;
            let vgs = 0;
            let uniqMuns = new Set();
            
            arrEscolas.forEach(sc => {
                imp += parseInt(sc.implantados || 0);
                vgs += parseInt(sc.vagos || 0);
                if (sc.municipio) uniqMuns.add(sc.municipio);
            });
            
            const munsStr = uniqMuns.size > 0 ? Array.from(uniqMuns).join(', ') : 'N/A';

            container.innerHTML += `
                <div style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: var(--radius); overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div style="padding: 10px 20px; font-weight: 600; font-size: 14px; color: #4361ee; border-bottom: 1px solid var(--border-color); background: var(--bg-color);">
                        Crê: ${con.cre || '-'}
                    </div>
                    <div style="padding: 20px;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                            <div>
                                <h3 style="margin: 0; font-size: 16px; color: var(--text-color);">Contrato: ${con.numero || '-'}</h3>
                                <div style="font-size: 12px; color: var(--text-light); margin-top: 4px;">${empName}</div>
                            </div>
                            <div style="display: flex; gap: 15px;">
                                <button class="btn-icon" style="color: #2b9348; font-size: 14px; display: flex; align-items: center; gap: 5px;" onclick="choiceExportPostos('${con.id}')">
                                    <i class='bx bx-download'></i> Relatório
                                </button>
                                <button class="btn-icon" style="color: #4361ee; font-size: 14px; display: flex; align-items: center; gap: 5px;" onclick="openEscolasModal('${con.id}')">
                                    <i class='bx bx-show'></i> Gerenciar Escolas
                                </button>
                            </div>
                        </div>
                        
                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; font-size: 13px; color: var(--text-light);">
                            <div><strong>Total de Escolas:</strong> <span style="color:var(--text-color)">${totalEscolas}</span></div>
                            <div><strong>Postos Implantados:</strong> <span style="color:var(--text-color)">${imp}</span></div>
                            <div><strong>Postos Vagos:</strong> <span style="color:var(--text-color)">${vgs}</span></div>
                            <div><strong>Municípios:</strong> <span style="color:var(--text-color)">${munsStr}</span></div>
                        </div>
                    </div>
                </div>
            `;
        });
    }

    const modalEscolas = document.getElementById('modal-escolas');
    const containerEscolasBlocks = document.getElementById('escolas-blocks-container');
    const btnCloseEscolasModal = document.getElementById('btn-close-escolas-modal');
    const btnFecharEscolas = document.getElementById('btn-fechar-escolas');
    const btnAddEscola = document.getElementById('btn-add-escola');
    const btnSalvarEscolas = document.getElementById('btn-salvar-escolas');

    let curEscolaContratoId = null;

    window.openEscolasModal = async function (contratoId) {
        curEscolaContratoId = contratoId;
        const con = getContratos().find(c => String(c.id) === String(contratoId));
        document.getElementById('modal-escolas-title').textContent = `Lotações - ${con ? con.numero : 'Contrato'}`;
        
        containerEscolasBlocks.innerHTML = '';
        const arr = cachedPostos.filter(p => String(p.contrato_id) === String(contratoId));
        
        if (arr.length === 0) {
            containerEscolasBlocks.innerHTML = '<div id="empty-escolas" style="text-align: center; color: var(--text-light); padding: 40px 0;">Nenhuma escola cadastrada para este contrato.</div>';
        } else {
            arr.forEach((esc, idx) => appendEscolaBlock(esc, idx));
        }
        modalEscolas.classList.remove('form-hidden');
    }

    function appendEscolaBlock(data = {}, uid = Date.now()) {
        const emptyDiv = document.getElementById('empty-escolas');
        if (emptyDiv) emptyDiv.remove();

        const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
        const isDisabled = user.role === 'usuario' ? 'disabled' : '';

        const block = document.createElement('div');
        block.className = 'escola-card';
        block.setAttribute('data-uid', uid);
        block.style.background = 'var(--card-bg)';
        block.style.border = '1px solid var(--border-color)';
        block.style.borderRadius = 'var(--radius)';
        block.style.padding = '15px';
        block.style.position = 'relative';

        block.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 15px; margin-bottom: 10px;">
                <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 11px;">Município</label>
                    <input type="text" class="esc-mun" value="${data.municipio || ''}" style="width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px; outline: none;" ${isDisabled}>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 11px;">Nome da Escola</label>
                    <input type="text" class="esc-nome" value="${data.nome || ''}" style="width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px; outline: none;" ${isDisabled}>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 15px;">
                <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 11px;">Valor Unitário</label>
                    <input type="text" class="esc-val" value="${data.valor || ''}" style="width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px; outline: none;" ${isDisabled}>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 11px;">Carga Horária</label>
                    <input type="text" class="esc-ch" value="${data.carga_horaria || ''}" placeholder="Ex: 40h" style="width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px; outline: none;" ${isDisabled}>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 11px;">Postos Implantados</label>
                    <input type="number" class="esc-imp" value="${data.implantados !== undefined ? data.implantados : '0'}" style="width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px; outline: none;" ${isDisabled}>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 11px;">Postos Vagos</label>
                    <input type="number" class="esc-vag" value="${data.vagos !== undefined ? data.vagos : '0'}" style="width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px; outline: none;" ${isDisabled}>
                </div>
            </div>
            
            ${user.role !== 'usuario' ? `
            <button class="btn-icon" style="position: absolute; bottom: 15px; right: 15px; color: var(--danger-color); padding: 5px;" onclick="this.parentElement.remove(); if(document.querySelectorAll('.escola-card').length === 0) document.getElementById('escolas-blocks-container').innerHTML = '<div id=\\\'empty-escolas\\\' style=\\\'text-align: center; color: var(--text-light); padding: 40px 0;\\\'>Nenhuma escola cadastrada para este contrato.</div>';">
                <i class='bx bx-trash' style="font-size: 18px;"></i>
            </button>` : ''}
        `;
        
        containerEscolasBlocks.appendChild(block);
    }

    if (btnAddEscola) {
        btnAddEscola.addEventListener('click', () => {
            appendEscolaBlock({}, Date.now());
            containerEscolasBlocks.scrollTo(0, containerEscolasBlocks.scrollHeight);
        });
    }

    // Lógica de Importação Excel para Escolas
    const btnImportExcel = document.getElementById('btn-import-escolas-excel');
    const inputImportExcel = document.getElementById('input-import-escolas-excel');

    if (btnImportExcel && inputImportExcel) {
        btnImportExcel.addEventListener('click', () => inputImportExcel.click());

        inputImportExcel.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const data = new Uint8Array(evt.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet);

                    if (jsonData.length === 0) {
                        return showToast('A planilha está vazia.', 'error');
                    }

                    // Remove a mensagem de "vazio" se existir
                    const emptyDiv = document.getElementById('empty-escolas');
                    if (emptyDiv) emptyDiv.remove();

                    jsonData.forEach((row, idx) => {
                        // Tenta mapear colunas por nomes comuns (Case-insensitive via Object.keys se necessário, mas aqui faremos direto)
                        const findVal = (keys) => {
                            for(let k of keys) {
                                if (row[k] !== undefined) return row[k];
                            }
                            return '';
                        };

                        const escola = {
                            municipio: findVal(['Município', 'Municipio', 'MUNICÍPIO', 'MUNICIPIO', 'City', 'Cidade']),
                            nome: findVal(['Escola', 'Nome', 'Nome da Escola', 'School', 'Name']),
                            valor: findVal(['Valor', 'Valor Unitário', 'Preço', 'Value', 'Price']),
                            carga_horaria: findVal(['Carga Horária', 'Carga', 'CH', 'Hours', 'Workload']),
                            implantados: findVal(['Implantados', 'Postos Implantados', 'Ativos']) || 0,
                            vagos: findVal(['Vagos', 'Postos Vagos', 'Vagas']) || 0
                        };
                        
                        appendEscolaBlock(escola, Date.now() + idx);
                    });

                    showToast(`${jsonData.length} escolas carregadas da planilha! Clique em Salvar para confirmar.`);
                    containerEscolasBlocks.scrollTo(0, containerEscolasBlocks.scrollHeight);
                    
                    // Reseta o input
                    inputImportExcel.value = '';
                } catch (err) {
                    console.error('Erro ao processar Excel:', err);
                    showToast('Erro ao processar o arquivo Excel.', 'error');
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    const closeModEsc = () => modalEscolas.classList.add('form-hidden');
    if (btnCloseEscolasModal) btnCloseEscolasModal.addEventListener('click', closeModEsc);
    if (btnFecharEscolas) btnFecharEscolas.addEventListener('click', closeModEsc);

    if (btnSalvarEscolas) {
        btnSalvarEscolas.addEventListener('click', async () => {
            if (!curEscolaContratoId) return;

            const cards = containerEscolasBlocks.querySelectorAll('.escola-card');
            let arr = [];

            cards.forEach(card => {
                arr.push({
                    municipio: card.querySelector('.esc-mun').value,
                    nome: card.querySelector('.esc-nome').value,
                    valor: card.querySelector('.esc-val').value,
                    carga_horaria: card.querySelector('.esc-ch').value,
                    implantados: card.querySelector('.esc-imp').value,
                    vagos: card.querySelector('.esc-vag').value
                });
            });

            try {
                await fetch(`${API_URL}/postos/save`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contratoId: curEscolaContratoId, escolas: arr })
                });
                await fetchAllData();
                showToast('Lotações de escola salvas com sucesso!');
                closeModEsc();
                loadPostosDashboard(); // refresh behind
            } catch (error) {
                showToast('Erro ao salvar lotações.', 'error');
            }
        });
    }


    document.getElementById('btn-relatorio-pdf')?.addEventListener('click', () => {
        window.print();
    });

    // ==========================================
    // INDENIZATÓRIOS (LOTES)
    // ==========================================
    let editingLoteId = null;
    const modalLote = document.getElementById('modal-lote');
    const formLote = document.getElementById('form-lote');

    function setLoteModalReadonly(readonly) {
        const inputs = document.querySelectorAll('#form-lote input, #form-lote select');
        inputs.forEach(i => i.disabled = readonly);
        
        const btnSave = document.querySelector('#form-lote button[type="submit"]');
        if (btnSave) btnSave.style.display = readonly ? 'none' : 'inline-block';
    }

    window.openModalLote = function() {
        editingLoteId = null;
        setLoteModalReadonly(false);
        document.getElementById('modal-lote-title').innerText = 'Novo Lote Indenizatório';
        formLote.reset();
        populateEmpresasSelect('lote-empresa');
        modalLote.classList.remove('form-hidden');
    };

    window.closeModalLote = function() {
        modalLote.classList.add('form-hidden');
    };

    if (formLote) {
        formLote.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {
                lote: document.getElementById('lote-numero').value,
                cre: document.getElementById('lote-cre').value,
                empresa_id: document.getElementById('lote-empresa').value,
                alunos: document.getElementById('lote-alunos').value,
                geo: document.getElementById('lote-geo').value,
                km: document.getElementById('lote-km').value,
                valor_km: parseFloat(document.getElementById('lote-valorkm').value.replace('R$', '').replace('.', '').replace(',', '.').trim()) || 0,
                valor_diario: parseFloat(document.getElementById('lote-valordiario').value.replace('R$', '').replace('.', '').replace(',', '.').trim()) || 0,
                username: JSON.parse(localStorage.getItem('currentUser'))?.usuario
            };

            try {
                const method = editingLoteId ? 'PUT' : 'POST';
                const url = editingLoteId ? `${API_URL}/indenizatorios/${editingLoteId}` : `${API_URL}/indenizatorios`;
                
                const res = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                if (!res.ok) throw new Error('Erro ao salvar lote');
                
                showToast('Lote salvo com sucesso!');
                closeModalLote();
                loadIndenizatoriosTable();
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    }

    async function loadIndenizatoriosTable() {
        const container = document.getElementById('lista-indenizatorios');
        if (!container) return;

        try {
            const res = await fetch(`${API_URL}/indenizatorios`);
            const lotes = await res.json();
            const resEmp = await fetch(`${API_URL}/empresas?system=${selectedSystem}`);
            const empresas = await resEmp.json();

            container.innerHTML = '';
            
            const userObj = JSON.parse(localStorage.getItem('currentUser'));
            const userRole = userObj?.role;
            const isAdmin = userRole === 'admin' || userRole === 'master';

            lotes.forEach(l => {
                const emp = empresas.find(e => e.id == l.empresa_id);
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid var(--border-color)';
                
                let actions = '';
                if (isAdmin) {
                    actions = `
                        <button class="btn-icon" onclick="editLoteIndenizatorio(${l.id})" style="color: #4361ee; margin-right: 8px;" title="Editar"><i class='bx bx-edit-alt'></i></button>
                        <button class="btn-icon" onclick="deleteLoteIndenizatorio(${l.id})" style="color: var(--danger-color);" title="Excluir"><i class='bx bx-trash'></i></button>
                    `;
                } else {
                    actions = `
                        <button class="btn-icon" onclick="viewLoteIndenizatorio(${l.id})" style="color: #4361ee;" title="Visualizar"><i class='bx bx-show'></i></button>
                    `;
                }

                tr.innerHTML = `
                    <td style="padding: 15px 20px; font-size: 14px; font-weight: 500; color: var(--text-color);">${l.lote}</td>
                    <td style="padding: 15px 20px; font-size: 13px; color: var(--text-light);">${l.cre}</td>
                    <td style="padding: 15px 20px; font-size: 13px; color: var(--text-color);">${emp ? emp.razao : 'N/A'}</td>
                    <td style="padding: 15px 20px; font-size: 13px; color: var(--text-color);">${l.alunos}</td>
                    <td style="padding: 15px 20px; font-size: 13px; color: var(--text-color);">${l.km}</td>
                    <td style="padding: 15px 20px; font-size: 13px; font-weight: 600; color: #4361ee;">${formatCurrency(l.valor_diario)}</td>
                    <td style="padding: 15px 20px; text-align: center;">
                        ${actions}
                    </td>
                `;
                container.appendChild(tr);
            });
        } catch (err) {
            console.error('Erro ao carregar indenizatórios:', err);
        }
    }

    window.editLoteIndenizatorio = async function(id) {
        try {
            const res = await fetch(`${API_URL}/indenizatorios`);
            const lotes = await res.json();
            const lote = lotes.find(l => String(l.id) === String(id));
            if (!lote) return;

            editingLoteId = id;
            setLoteModalReadonly(false);
            document.getElementById('modal-lote-title').innerText = 'Editar Lote Indenizatório';
            
            document.getElementById('lote-numero').value = lote.lote || '';
            document.getElementById('lote-cre').value = lote.cre || '';
            populateEmpresasSelect('lote-empresa');
            document.getElementById('lote-empresa').value = lote.empresa_id || '';
            document.getElementById('lote-alunos').value = lote.alunos || 0;
            document.getElementById('lote-geo').value = lote.geo || '';
            document.getElementById('lote-km').value = lote.km || 0;
            document.getElementById('lote-valorkm').value = formatCurrency(lote.valor_km);
            document.getElementById('lote-valordiario').value = formatCurrency(lote.valor_diario);

            if (modalLote) modalLote.classList.remove('form-hidden');
        } catch (err) {
            showToast('Erro ao carregar dados do lote', 'error');
        }
    };

    window.viewLoteIndenizatorio = async function(id) {
        await editLoteIndenizatorio(id);
        document.getElementById('modal-lote-title').innerText = 'Visualizar Lote Indenizatório';
        setLoteModalReadonly(true);
    };

    window.deleteLoteIndenizatorio = async function(id) {
        if (confirm('Tem certeza que deseja excluir permanentemente este lote?')) {
            try {
                const userObj = JSON.parse(localStorage.getItem('currentUser'));
                const userRole = userObj?.role;
                const username = userObj?.usuario;

                const res = await fetch(`${API_URL}/indenizatorios/${id}?userRole=${userRole}&username=${username}`, { method: 'DELETE' });
                const data = await res.json();

                if (!res.ok) {
                    if (data.requested) {
                        return showToast(data.message, 'info');
                    }
                    throw new Error(data.error || 'Erro ao excluir lote');
                }

                // Small delay and full sync
                await new Promise(r => setTimeout(r, 500));
                await fetchAllData();
                loadIndenizatoriosTable();
                showToast('Lote excluído com sucesso');
            } catch (error) {
                console.error('Erro ao excluir lote:', error);
                showToast(error.message, 'error');
            }
        }
    };

    // Currency masks for the new modal
    setTimeout(() => {
        ['lote-valorkm', 'lote-valordiario'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', maskCurrency);
        });
    }, 1000);

    // Patch navigation system to handle the new section
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[data-target="indenizatorios"]');
        if (link) {
            loadIndenizatoriosTable();
        }
    });

    // ==========================================
    // EXPORTAÇÕES E LOGS
    // ==========================================
    window.exportDataToExcel = function(data, filename) {
        if (!data || data.length === 0) return showToast('Nenhum dado para exportar', 'error');
        try {
            let wb = XLSX.utils.book_new();
            let ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, "Dados");
            XLSX.writeFile(wb, filename + ".xlsx");
            showToast('Arquivo Excel exportado!', 'success');
        } catch(e) { showToast('Erro ao exportar Excel', 'error'); }
    };

    window.exportDataToPDF = function(data, title) {
        if (!data || data.length === 0) return showToast('Nenhum dado para exportar', 'error');
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('landscape'); 
            doc.text(title, 14, 15);
            const head = [Object.keys(data[0])];
            const body = data.map(obj => Object.values(obj));
            doc.autoTable({ head: head, body: body, startY: 20, theme: 'grid', styles: { fontSize: 8 } });
            doc.save(title + ".pdf");
            showToast('PDF Exportado!', 'success');
        } catch(e) { showToast('Erro ao exportar PDF', 'error'); }
    };

    window.exportEmpresas = function(type) {
        const data = getEmpresas().map(e => ({
            'Razão Social': e.razao,
            'CNPJ': e.cnpj,
            'E-mail': e.email,
            'Telefone': e.telefone
        }));
        if(type === 'Excel') exportDataToExcel(data, 'Empresas_Cadastradas');
        else exportDataToPDF(data, 'Relação de Empresas');
    };

    window.exportContratos = function(type) {
        const data = getContratos().map(c => {
            const emp = getEmpresas().find(e => String(e.id) === String(c.empresaId));
            return {
                'Número': c.numero,
                'PROA': c.proa,
                'Lote': c.lote,
                'Serviço': c.tipo,
                'Empresa': emp ? emp.razao : 'N/A',
                'Status': c.situacao,
                'Gestor': c.gestor
            };
        });
        if(type === 'Excel') exportDataToExcel(data, 'Contratos_Ativos');
        else exportDataToPDF(data, 'Relação de Contratos');
    };

    window.exportIndenizatorios = async function(type) {
        try {
            const resLotes = await fetch(`${API_URL}/indenizatorios`);
            const lotes = await resLotes.json();
            const resEmp = await fetch(`${API_URL}/empresas?system=${selectedSystem}`);
            const empresas = await resEmp.json();
            
            const data = lotes.map(l => {
                const emp = empresas.find(e => String(e.id) === String(l.empresa_id));
                return {
                    'Lote': l.lote,
                    'CRE': l.cre,
                    'Empresa': emp ? emp.razao : 'N/A',
                    'Alunos': l.alunos,
                    'KM': l.km,
                    'Valor Diário (R$)': l.valor_diario
                };
            });
            if(type === 'Excel') exportDataToExcel(data, 'Lotes_Indenizatorios');
            else exportDataToPDF(data, 'Relatório de Lotes Indenizatórios');
        } catch(err) {
            showToast('Erro ao obter dados', 'error');
        }
    };

    window.exportFaturamentos = async function(type) {
        if (!currentFatContratoId) {
            return showToast('Nenhum contrato selecionado.', 'error');
        }
        
        const ano = document.getElementById('select-ano-fat').value;
        const con = getContratos().find(c => String(c.id) === String(currentFatContratoId));
        if(!con) return showToast('Contrato não encontrado', 'error');

        const empresas = getEmpresas();
        const emp = empresas.find(e => String(e.id) === String(con.empresaId));
        const empName = emp ? emp.razao : 'Desconhecida';
        
        let dbFat = await getDbFatFromServer(ano);
        const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

        let exportData = [];
        let fatList = dbFat[con.id] || [];
        
        for (let i = 0; i < 12; i++) {
            const data = fatList[i] || {};
            // Exporta a linha se houver dados relevantes
            if(data.valor > 0 || data.processo || data.abertura || data.situacao === 'Pago' || data.km > 0 || data.dias > 0) {
                let row = {
                    'Ano': ano,
                    'Mês': months[i],
                    'Empresa': empName,
                    'Nº Contrato': con.numero || '-',
                    'Processo FAT': data.processo || '-'
                };

                if (con.tipo === 'Transporte Escolar') {
                    row['GEO'] = data.geo || '-';
                    row['KM'] = data.km || '0';
                    row['Valor Km'] = data.valorKm ? formatCurrency(data.valorKm) : 'R$ 0,00';
                    row['Valor Diário'] = data.valorDiario ? formatCurrency(data.valorDiario) : 'R$ 0,00';
                    row['Dias'] = data.dias || '0';
                }

                row['Situação'] = data.situacao || 'Pendente';
                row['Data Pag.'] = data.pagamento ? data.pagamento.split('-').reverse().join('/') : '-';
                row['Total Faturado (R$)'] = data.valor ? formatCurrency(parseFloat(data.valor) || 0) : 'R$ 0,00';

                exportData.push(row);
            }
        }
 
        if (exportData.length === 0) {
            return showToast(`Nenhum faturamento registrado em ${ano} para este contrato.`, 'error');
        }
 
        if(type === 'Excel') exportDataToExcel(exportData, `Faturamentos_${con.numero || 'Sem_Num'}_${ano}`);
        else exportDataToPDF(exportData, `Relatório Faturamento - Contrato ${con.numero || 'Sem Número'} (${ano})`);
    };

    // --- NOVAS FUNÇÕES DE EXPORTAÇÃO DE POSTOS ---

    window.choiceExportPostos = function(id) {
        const modalView = document.getElementById('generic-modal');
        const modalBody = document.getElementById('modal-body');
        const title = document.getElementById('modal-generic-title');
        
        if (title) title.textContent = "Exportar Relatório de Postos";
        
        modalBody.innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <p style="margin-bottom: 25px; color: var(--text-light); font-size: 15px;">Selecione o formato desejado para exportar os dados dos postos deste contrato.</p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; justify-content: center; max-width: 400px; margin: 0 auto;">
                    <button class="btn" onclick="exportPostosRelatorio('${id}', 'Excel'); document.getElementById('generic-modal').classList.add('form-hidden');" style="background: #217346; color: #fff; border: none; padding: 25px 20px; border-radius: 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; transition: transform 0.2s ease; cursor: pointer;">
                        <i class='bx bx-file-blank' style="font-size: 40px;"></i>
                        <span style="font-weight: 600; font-size: 14px;">Excel (.xlsx)</span>
                    </button>
                    <button class="btn" onclick="exportPostosRelatorio('${id}', 'PDF'); document.getElementById('generic-modal').classList.add('form-hidden');" style="background: #e63946; color: #fff; border: none; padding: 25px 20px; border-radius: 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; transition: transform 0.2s ease; cursor: pointer;">
                        <i class='bx bxs-file-pdf' style="font-size: 40px;"></i>
                        <span style="font-weight: 600; font-size: 14px;">PDF (.pdf)</span>
                    </button>
                </div>
            </div>
        `;
        
        modalView.classList.remove('form-hidden');
    };

    window.exportPostosRelatorio = async function(contratoId, type) {
        const con = getContratos().find(c => String(c.id) === String(contratoId));
        if(!con) return showToast('Contrato não encontrado', 'error');

        const emp = getEmpresas().find(e => String(e.id) === String(con.empresaId));
        const empName = emp ? emp.razao : 'Desconhecida';
        
        // Filtra os postos desse contrato do cache global
        const arrEscolas = cachedPostos.filter(p => String(p.contrato_id) === String(contratoId));
        
        if (arrEscolas.length === 0) {
            return showToast('Nenhuma escola/posto cadastrado para este contrato.', 'error');
        }

        const data = arrEscolas.map(esc => ({
            'Município': esc.municipio || '-',
            'Escola': esc.nome || '-',
            'Valor Unitário': esc.valor || '-',
            'Carga Horária': esc.carga_horaria || '-',
            'Implantados': esc.implantados || 0,
            'Vagos': esc.vagos || 0
        }));

        const filename = `Relatorio_Postos_Contrato_${(con.numero || 'S-N').replace(/[/\\?%*:|"<>]/g, '_')}`;
        const title = `Relatório de Postos - Contrato ${con.numero || '-'} (${empName})`;

        if (type === 'Excel') {
            exportDataToExcel(data, filename);
        } else {
            exportDataToPDF(data, title);
        }
    };
 
});
