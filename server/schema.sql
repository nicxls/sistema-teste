-- Script de Criação do Banco de Dados: sistema_gestao
-- USE ESTE SCRIPT NO PHPMYADMIN OU MYSQL WORKBENCH

CREATE DATABASE IF NOT EXISTS sistema_gestao;
USE sistema_gestao;

-- Tabela de Usuários
CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario VARCHAR(100) NOT NULL UNIQUE,
    senha VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabela de Empresas
CREATE TABLE IF NOT EXISTS empresas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    razao VARCHAR(255) NOT NULL,
    email VARCHAR(150),
    telefone VARCHAR(20),
    sistema VARCHAR(50) DEFAULT 'mao-de-obra'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabela de Contratos
CREATE TABLE IF NOT EXISTS contratos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero VARCHAR(50),
    proa VARCHAR(50),
    lote VARCHAR(50),
    cre VARCHAR(50),
    tipo VARCHAR(50),
    empresa_id INT,
    periodo_inicial DATE,
    periodo_final DATE,
    situacao VARCHAR(50),
    gestor VARCHAR(150),
    -- Campos Transporte
    alunos INT DEFAULT 0,
    municipio VARCHAR(150),
    valor_diario DECIMAL(12, 2) DEFAULT 0,
    valor_km DECIMAL(12, 2) DEFAULT 0,
    km DECIMAL(12, 2) DEFAULT 0,
    -- Campos Mão de Obra
    valor_mensal DECIMAL(12, 2) DEFAULT 0,
    postos TEXT,
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabela de Solicitações de Acesso
CREATE TABLE IF NOT EXISTS solicitacoes_acesso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(150) NOT NULL,
    senha VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'pendente',
    data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabela de Postos/Escolas (Sub-itens dos contratos)
CREATE TABLE IF NOT EXISTS escolas_alocadas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    contrato_id INT NOT NULL,
    municipio VARCHAR(150),
    nome VARCHAR(255),
    valor VARCHAR(100), -- Mantendo como string pois pode ser formatado ou conter unidades
    carga_horaria VARCHAR(50),
    implantados INT DEFAULT 0,
    vagos INT DEFAULT 0,
    FOREIGN KEY (contrato_id) REFERENCES contratos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Usuário Master Padrão
INSERT IGNORE INTO usuarios (usuario, senha, role) 
VALUES ('nicolas-silva', 'inter2017', 'master');
