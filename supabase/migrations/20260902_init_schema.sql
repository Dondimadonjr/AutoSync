-- =========================================================================
-- MIGRACIÓN DE BASE DE DATOS SUPABASE: SocialSync Enterprise Schema
-- =========================================================================

-- 1. TIPOS ENUM PERSONALIZADOS
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'post_status') THEN
        CREATE TYPE post_status AS ENUM (
            'borrador',
            'aprobado',
            'procesando',
            'publicado',
            'fallido',
            'rechazado'
        );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform_type') THEN
        CREATE TYPE platform_type AS ENUM (
            'instagram',
            'tiktok',
            'facebook'
        );
    END IF;
END $$;

-- 2. TABLA: Clientes
CREATE TABLE IF NOT EXISTS clientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(150) NOT NULL,
    telegram_chat_id BIGINT UNIQUE NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. TABLA: Credenciales de Redes Sociales
CREATE TABLE IF NOT EXISTS credenciales_redes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    plataforma platform_type NOT NULL,
    cuenta_id VARCHAR(150) NOT NULL, -- Ej: ID de cuenta de Instagram Business o Fanpage
    token_acceso TEXT NOT NULL,      -- Long-Lived Token o System User Token
    token_expira_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(cliente_id, plataforma)
);

-- 4. TABLA: Publicaciones
CREATE TABLE IF NOT EXISTS publicaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    caption TEXT NOT NULL,
    media_url TEXT NOT NULL,
    plataformas platform_type[] NOT NULL DEFAULT '{instagram}',
    estado post_status NOT NULL DEFAULT 'borrador',
    sugerencia_visual TEXT,
    telegram_message_id BIGINT,
    instagram_container_id VARCHAR(150),
    instagram_post_id VARCHAR(150),
    error_detalle TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. TABLA: Logs de Auditoría y Eventos
CREATE TABLE IF NOT EXISTS logs_publicacion (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    publicacion_id UUID REFERENCES publicaciones(id) ON DELETE SET NULL,
    evento VARCHAR(100) NOT NULL,
    nivel VARCHAR(20) NOT NULL DEFAULT 'INFO',
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. ÍNDICES DE ALTO RENDIMIENTO
CREATE INDEX IF NOT EXISTS idx_publicaciones_cliente_estado ON publicaciones(cliente_id, estado);
CREATE INDEX IF NOT EXISTS idx_publicaciones_estado ON publicaciones(estado);
CREATE INDEX IF NOT EXISTS idx_credenciales_cliente_plataforma ON credenciales_redes(cliente_id, plataforma);
CREATE INDEX IF NOT EXISTS idx_clientes_telegram_chat_id ON clientes(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_logs_publicacion_id ON logs_publicacion(publicacion_id);

-- 7. CONFIGURACIÓN DE ROW LEVEL SECURITY (RLS)
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credenciales_redes ENABLE ROW LEVEL SECURITY;
ALTER TABLE publicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs_publicacion ENABLE ROW LEVEL SECURITY;

-- Políticas para Service Role (Bypass completo para el backend autenticado)
DROP POLICY IF EXISTS "service_role_all_clientes" ON clientes;
CREATE POLICY "service_role_all_clientes" ON clientes FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_all_credenciales" ON credenciales_redes;
CREATE POLICY "service_role_all_credenciales" ON credenciales_redes FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_all_publicaciones" ON publicaciones;
CREATE POLICY "service_role_all_publicaciones" ON publicaciones FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_all_logs" ON logs_publicacion;
CREATE POLICY "service_role_all_logs" ON logs_publicacion FOR ALL USING (auth.role() = 'service_role');
