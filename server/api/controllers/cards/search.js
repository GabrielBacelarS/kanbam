const moment = require('moment');

const Errors = {
  NOT_ENOUGH_RIGHTS: {
    notEnoughRights: 'Not enough rights',
  },
};

module.exports = {
  inputs: {
    startDate: {
      type: 'string',
      description: 'Data inicial para filtrar (YYYY-MM-DD)',
      custom: (value) => moment(value, 'YYYY-MM-DD', true).isValid(),
      required: false,
    },
    endDate: {
      type: 'string',
      description: 'Data final para filtrar (YYYY-MM-DD)',
      custom: (value) => moment(value, 'YYYY-MM-DD', true).isValid(),
      required: false,
    },
    boardId: {
      type: 'string',
      regex: /^[0-9]+$/,
      required: false,
    },
    listId: {
      type: 'string',
      regex: /^[0-9]+$/,
      required: false,
    },
    name: {
      type: 'string',
      required: false,
    },
    description: {
      type: 'string',
      required: false,
    },
  },

  exits: {
    notEnoughRights: {
      responseType: 'forbidden',
    },
  },

  async fn(inputs) {
    const { currentUser } = this.req;

    // Construir os critérios de busca
    const criteria = {};

    // Filtrar por datas se especificados
    if (inputs.startDate || inputs.endDate) {
      criteria.createdAt = {};

      if (inputs.startDate) {
        const startDate = moment(inputs.startDate).startOf('day').toISOString();
        criteria.createdAt['>='] = startDate;
      }

      if (inputs.endDate) {
        const endDate = moment(inputs.endDate).endOf('day').toISOString();
        criteria.createdAt['<='] = endDate;
      }
    }

    // Filtrar por nome se especificado
    if (inputs.name) {
      criteria.name = { contains: inputs.name };
    }

    // Filtrar por descrição se especificado
    if (inputs.description) {
      criteria.description = { contains: inputs.description };
    }

    // Filtrar por boardId se especificado
    if (inputs.boardId) {
      criteria.boardId = inputs.boardId;

      // Verificar permissões para o board específico
      const board = await Board.findOne(inputs.boardId);
      if (!board) {
        return {
          items: [],
          total: 0, // Adicionando contagem total
        };
      }

      const boardMembership = await BoardMembership.findOne({
        boardId: inputs.boardId,
        userId: currentUser.id,
      });

      const isProjectManager = await sails.helpers.users.isProjectManager(
        currentUser.id,
        board.projectId,
      );

      if (!boardMembership && !isProjectManager) {
        throw Errors.NOT_ENOUGH_RIGHTS;
      }
    }

    // Filtrar por listId se especificado
    if (inputs.listId) {
      criteria.listId = inputs.listId;
    }

    // Buscar os cards com os critérios definidos
    const cards = await sails.helpers.cards.getMany(criteria);

    // Processar os cartões em paralelo com Promise.all
    const accessibilityPromises = cards.map(async (card) => {
      // Para cada card, verificar acesso e adicionar informações
      const [isBoardMember, cardBoard] = await Promise.all([
        sails.helpers.users.isBoardMember(currentUser.id, card.boardId),
        Board.findOne(card.boardId),
      ]);

      const projectId = cardBoard ? cardBoard.projectId : null;

      const isProjectManager = await sails.helpers.users.isProjectManager(
        currentUser.id,
        projectId,
      );

      if (isBoardMember || isProjectManager) {
        // Adicionar campo isSubscribed
        // eslint-disable-next-line no-param-reassign
        card.isSubscribed = await sails.helpers.users.isCardSubscriber(currentUser.id, card.id);
        return card;
      }

      return null;
    });

    // Filtrar cards nulos (sem acesso) após resolução de todas as promessas
    const resolvedCards = await Promise.all(accessibilityPromises);
    const accessibleCards = resolvedCards.filter((card) => card !== null);

    // Buscar informações adicionais para os cartões
    if (accessibleCards.length > 0) {
      // eslint-disable-next-line prettier/prettier
      const cardIds = accessibleCards.map(card => card.id);

      // Buscar memberships, labels e tasks para todos os cartões
      const cardMemberships = await sails.helpers.cards.getCardMemberships(cardIds);
      const cardLabels = await sails.helpers.cards.getCardLabels(cardIds);
      const tasks = await sails.helpers.cards.getTasks(cardIds);

      return {
        items: accessibleCards,
        total: accessibleCards.length, // Campo com o total de itens encontrados
        included: {
          cardMemberships,
          cardLabels,
          tasks,
        },
      };
    }

    return {
      items: [],
      total: 0, // Campo com contagem zero quando não há resultados
      included: {
        cardMemberships: [],
        cardLabels: [],
        tasks: [],
      },
    };
  },
};
