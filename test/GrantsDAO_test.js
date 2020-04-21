const { BN, constants, expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers')

contract('GrantsDAO', (accounts) => {
  const GrantsDAO = artifacts.require('GrantsDAO')
  const SNXToken = artifacts.require('MockToken')

  const defaultAccount = accounts[0]
  const teamMember1 = accounts[1]
  const teamMember2 = accounts[2]
  const communityMember1 = accounts[3]
  const communityMember2 = accounts[4]
  const communityMember3 = accounts[5]
  const stranger = accounts[6]
  const teamMembers = [teamMember1, teamMember2]
  const communityMembers = [communityMember1, communityMember2, communityMember3]

  const toPass = new BN(4)
  const oneToken = web3.utils.toWei('1')
  const tokenName = 'Synthetix Network Token'
  const tokenSymbol = 'SNX'
  const tokenDecimals = new BN(18)
  const tokenInitialSupply = web3.utils.toWei('1000')
  const after1Day = 86401
  const after2Days = 172801
  const after9Days = 777601

  const description = 'This is a proposal'
  const url = 'https://example.com'

  let dao, snx, randomToken

  beforeEach(async () => {

    snx = await SNXToken.new(
      tokenName,
      tokenSymbol,
      tokenDecimals,
      tokenInitialSupply,
      { from: defaultAccount },
    )
    dao = await GrantsDAO.new(
      snx.address,
      teamMembers,
      communityMembers,
      toPass,
      { from: defaultAccount },
    )
    randomToken = await SNXToken.new(
      "Random Token",
      "RND",
      new BN(18),
      tokenInitialSupply,
      { from: defaultAccount },
    )
  })

  describe('constructor', () => {
    it('deploys with the specified addresses as signers', async () => {
      teamMembers.forEach(async s => assert.isTrue(await dao.teamMembers.call(s)))
      communityMembers.forEach(async s => assert.isTrue(await dao.communityMembers.call(s)))
    })

    it('deploys with the specified token address', async () => {
      assert.equal(snx.address, await dao.SNX.call())
    })

    it('deploys with the specified toPass value', async () => {
      assert.isTrue(toPass.eq(await dao.toPass.call()))
    })

    context('when teamMembers is 0', () => {
      it('reverts', async () => {
        const noMembers = []
        await expectRevert(
          GrantsDAO.new(
            snx.address,
            noMembers,
            communityMembers,
            new BN(communityMembers.length),
            { from: defaultAccount },
          ),
          'Need at least one teamMember',
        )
      })
    })

    context('when toPass is less than members', () => {
      it('reverts', async () => {
        const tooMany = teamMembers.length + communityMembers.length + 1
        await expectRevert(
          GrantsDAO.new(
            snx.address,
            teamMembers,
            communityMembers,
            new BN(tooMany),
            { from: defaultAccount },
          ),
          'Invalid value to pass proposals',
        )
      })
    })
  })

  describe('createProposal', () => {
    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.createProposal(stranger, oneToken, description, url, { from: stranger }),
          'Not proposer',
        )
      })
    })

    context('when called by a proposer', () => {
      context('and the DAO is not funded', () => {
        it('emits the NewProposal event', async () => {
          const tx = await dao.createProposal(stranger, oneToken, description, url, { from: teamMember1 })
          expectEvent(tx.receipt, 'NewProposal', {
            receiver: stranger,
            amount: oneToken,
            proposalNumber: new BN(1),
          })
        })
      })
      context('and the DAO is funded', () => {
        beforeEach(async () => {
          await snx.transfer(dao.address, oneToken, { from: defaultAccount })
          assert.equal(oneToken, await dao.withdrawable.call())
          assert.equal(oneToken, await dao.totalBalance.call())
        })

        it('emits the NewProposal event', async () => {
          const tx = await dao.createProposal(stranger, oneToken, description, url, { from: teamMember1 })
          expectEvent(tx.receipt, 'NewProposal', {
            receiver: stranger,
            amount: oneToken,
            proposalNumber: new BN(1),
          })
        })

        it('returns the proposal number', async () => {
          const proposal = await dao.createProposal.call(stranger, oneToken, description, url, { from: teamMember1 })
          assert.isTrue(new BN(1).eq(proposal))
        })

        it('creates a proposal', async () => {
          await dao.createProposal(stranger, oneToken, description, url, { from: teamMember1 })
          const proposal = await dao.proposals(1)
          assert.equal(oneToken.toString(), proposal.amount.toString())
          assert.equal(stranger, proposal.receiver)
          assert.equal(description, proposal.description)
          assert.equal(url, proposal.url)
          assert.isTrue(proposal.createdAt.gt(0))
        })

        it('adds to the array of valid proposals', async () => {
          const expected = ['1']
          await dao.createProposal(stranger, oneToken, description, url, { from: teamMember1 })
          const proposals = await dao.getProposals.call()
          const proposalsStrings = proposals.map(p => p.toString())
          assert.deepEqual(expected, proposalsStrings)
        })

        it('reverts for 0 in amount', async () => {
          await expectRevert(
            dao.createProposal(stranger, 0, description, url, { from: teamMember1 }),
            'Amount must be greater than 0',
          )
        })

        it('reverts for zero address in receiver', async () => {
          await expectRevert(
            dao.createProposal(constants.ZERO_ADDRESS, oneToken, description, url, { from: teamMember1 }),
            'Receiver cannot be zero address',
          )
        })

        it('counts the proposal as voted by the proposer', async () => {
          await dao.createProposal(stranger, oneToken, description, url, { from: teamMember1 })
          assert.isTrue(await dao.voted.call(teamMember1, 1))
        })

        context('when proposed by a team member', () => {
          let proposal

          beforeEach(async () => {
            await dao.createProposal(stranger, oneToken, description, url, { from: teamMember1 })
            proposal = await dao.proposals.call(1)
          })

          it('marks the proposal as approved by the team', async () => {
            assert.isTrue(proposal.teamApproval)
          })
        })

        context('when proposed by a community member', () => {
          let proposal

          beforeEach(async () => {
            await dao.createProposal(stranger, oneToken, description, url, { from: communityMember1 })
            proposal = await dao.proposals.call(1)
          })

          it('does not mark the proposal as approved by the team', async () => {
            assert.isFalse(proposal.teamApproval)
          })
        })
      })
    })
  })

  describe('voteProposal', () => {
    beforeEach(async () => {
      await snx.transfer(dao.address, oneToken, { from: defaultAccount })
      await dao.createProposal(stranger, oneToken, description, url, { from: communityMember3 })
    })

    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.voteProposal(1, true, { from: stranger }),
          'Not proposer',
        )
      })
    })

    context('when called by a proposer', () => {
      context('when the proposal is outside of voting phase', () => {
        beforeEach(async () => {
          await time.increase(after9Days)
        })

        it('reverts', async () => {
          await expectRevert(
            dao.voteProposal(1, true, { from: communityMember1 }),
            'Proposal not in voting phase',
          )
        })
      })

      context('when the proposal is inside the voting phase', () => {
        beforeEach(async () => {
          await time.increase(after2Days)
        })

        it('allows the proposal to be voted on', async () => {
          const tx = await dao.voteProposal(1, true, { from: communityMember1 })
          expectEvent(tx, 'VoteProposal', {
            proposal: new BN(1),
            member: communityMember1,
            vote: true,
          })
          const proposal = await dao.proposals.call(1)
          assert.isTrue(new BN(2).eq(proposal.approvals))
          assert.isTrue(await dao.voted.call(communityMember1, 1))
        })

        context('when the proposal has already been voted on by a member', () => {
          it('reverts', async () => {
            await expectRevert(
              dao.voteProposal(1, true, { from: communityMember3 }),
              'Already voted',
            )
          })
        })

        context('when all the community members have voted', () => {
          let proposal

          beforeEach(async () => {
            await dao.voteProposal(1, true, { from: communityMember2 })
            await dao.voteProposal(1, true, { from: communityMember1 })
            proposal = await dao.proposals.call(1)
            assert.isFalse(proposal.teamApproval)
            assert.isTrue(new BN(3).eq(proposal.approvals))
          })

          it('does not execute the proposal until a team member approves', async () => {
            const tx = await dao.voteProposal(1, true, { from: teamMember1 })
            expectEvent(tx.receipt, 'ExecuteProposal', {
              receiver: proposal.receiver,
              amount: proposal.amount,
            })
          })
        })

        context('when enough votes have been reached to pass', () => {
          let tx, proposal

          beforeEach(async () => {
            proposal = await dao.proposals.call(1)
            await dao.voteProposal(1, true, { from: teamMember2 })
            await dao.voteProposal(1, true, { from: communityMember1 })
            tx = await dao.voteProposal(1, true, { from: communityMember2 })
          })

          it('emits the ExecuteProposal event', async () => {
            expectEvent(tx.receipt, 'ExecuteProposal', {
              receiver: proposal.receiver,
              amount: proposal.amount,
            })
          })

          it('deletes the proposal from storage', async () => {
            const deleted = await dao.proposals.call(1)
            assert.equal(deleted.receiver, constants.ZERO_ADDRESS)
            assert.isTrue(deleted.amount.eq(new BN(0)))
            assert.isTrue(deleted.createdAt.eq(new BN(0)))
            assert.isTrue(deleted.approvals.eq(new BN(0)))
          })

          it('deletes the proposal ID from the list of valid proposals', async () => {
            const expected = []
            assert.deepEqual(expected, await dao.getProposals.call())
          })

          it('sends the proposal amount to the receiver', async () => {
            assert.isTrue(new BN(oneToken).eq(await snx.balanceOf(stranger)))
          })

        })

        context('when there is not enough SNX to pay the grant', () => {
          let tx, proposal

          beforeEach(async () => {
            proposal = await dao.proposals.call(1)
            await dao.withdraw(teamMember1, await dao.withdrawable.call(), {from: teamMember1})
            await dao.voteProposal(1, true, { from: teamMember2 })
            await dao.voteProposal(1, true, { from: communityMember1 })
          })

          it('reverts', async () => {
            await expectRevert(
              dao.voteProposal(1, true, { from: communityMember2 }),
              'Not enough SNX to execute proposal',
            )
          })

        })

    })

    context('when multiple proposals are active', () => {
      beforeEach(async () => {
        await time.increase(after1Day)
        await snx.transfer(dao.address, oneToken, { from: defaultAccount })
        await dao.createProposal(stranger, oneToken, description, url, { from: communityMember3 })
      })

        it('only allows voting for valid proposals', async () => {
          const tx = await dao.voteProposal(1, true, { from: communityMember1 })
          expectEvent(tx, 'VoteProposal', {
            proposal: new BN(1),
            member: communityMember1,
            vote: true,
          })
          const proposal = await dao.proposals.call(1)
          assert.isTrue(new BN(2).eq(proposal.approvals))
          assert.isTrue(await dao.voted.call(communityMember1, 1))
        })

        it('allows proposals in the voting phase to be executed', async () => {
          const proposal1 = await dao.proposals.call(1)
          await dao.voteProposal(1, true, { from: communityMember1 })
          await dao.voteProposal(1, true, { from: communityMember2 })
          const tx = await dao.voteProposal(1, true, { from: teamMember2 })
          expectEvent(tx.receipt, 'ExecuteProposal', {
            receiver: proposal1.receiver,
            amount: proposal1.amount,
          })

          const proposal2 = await dao.proposals.call(2)
          assert.equal(oneToken.toString(), proposal2.amount.toString())
          assert.equal(stranger, proposal2.receiver)
          assert.isTrue(proposal2.createdAt.gt(0))
        })
      })
    })
  })

  describe('deleteProposal', () => {
    beforeEach(async () => {
      await snx.transfer(dao.address, oneToken, { from: defaultAccount })
      await dao.createProposal(stranger, oneToken, description, url, { from: teamMember1 })
    })

    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.deleteProposal(1, { from: stranger }),
          'Not proposer',
        )
      })
    })

    context('when called by a proposer', () => {
      context('when the proposal is not expired', () => {
        it('reverts', async () => {
          await expectRevert(
            dao.deleteProposal(1, { from: teamMember1 }),
            'Proposal not expired',
          )
        })
      })

      context('when the proposal is expired', () => {
        beforeEach(async () => {
          await time.increase(after9Days)
        })

        it('emits the DeleteProposal event', async () => {
          const tx = await dao.deleteProposal(1, { from: teamMember1 })
          expectEvent(tx.receipt, 'DeleteProposal', {
            proposalNumber: new BN(1),
          })
        })

        it('deletes the proposal ID from the list of valid proposals', async () => {
          const expected = []
          await dao.deleteProposal(1, { from: teamMember1 })
          assert.deepEqual(expected, await dao.getProposals.call())
        })
      })
    })
  })

  describe('withdrawable', () => {
    context('when the contract is not funded', () => {
      it('returns 0', async () => {
        assert.isTrue(new BN(0).eq(await dao.withdrawable.call()))
      })

      context('when the contract is funded', () => {
        beforeEach(async () => {
          await snx.transfer(dao.address, oneToken, { from: defaultAccount })
        })

        it('returns the amount that was funded', async () => {
          assert.isTrue(new BN(oneToken).eq(await dao.withdrawable.call()))
        })

        context('when a proposal is created', () => {
          beforeEach(async () => {
            await snx.transfer(dao.address, oneToken, { from: defaultAccount })
            await dao.createProposal(stranger, oneToken, description, url, { from: teamMember1 })
          })
        })
      })
    })
  })

  describe('withdraw', () => {
    beforeEach(async () => {
      await snx.transfer(dao.address, oneToken, { from: defaultAccount })
    })

    context('when called by a community member', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.withdraw(stranger, oneToken, { from: communityMember1 }),
          'Not team member',
        )
      })
    })

    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.withdraw(stranger, oneToken, { from: stranger }),
          'Not team member',
        )
      })
    })

    context('when called by a team member', () => {
      it('allows funds to be withdrawn', async () => {
        await dao.withdraw(stranger, oneToken, { from: teamMember1 })
        assert.isTrue(new BN(oneToken).eq(await snx.balanceOf(stranger)))
        assert.isTrue(new BN(0).eq(await snx.balanceOf(dao.address)))
      })

      context('when a proposal is created', () => {
        beforeEach(async () => {
          await dao.createProposal(stranger, oneToken, description, url, { from: teamMember1 })
        })

        it('allows any ERC20 funds to be withdrawn', async () => {
          await randomToken.transfer(dao.address, oneToken, { from: defaultAccount })
          await dao.withdrawERC20(stranger, oneToken, randomToken.address, { from: teamMember1 })
          assert.isTrue(new BN(oneToken).eq(await randomToken.balanceOf(stranger)))
          assert.isTrue(new BN(0).eq(await randomToken.balanceOf(dao.address)))
        })
      })
    })
  })

  describe('addCommunityMember', () => {
    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.addCommunityMember(stranger, { from: stranger }),
          'Not team member',
        )
      })
    })

    context('when called by a team member', () => {
      it('adds the member as a proposer', async () => {
        await dao.addCommunityMember(stranger, { from: teamMember1 })
        assert.isTrue(await dao.communityMembers.call(stranger))
      })

      it('adds the member to the communityAddresses', async () => {
        const expected = [communityMember1, communityMember2, communityMember3, stranger]
        await dao.addCommunityMember(stranger, { from: teamMember1 })
        assert.deepEqual(expected, await dao.getCommunityMembers.call())
      })

      context('when members have already voted on a proposal', () => {
        beforeEach(async () => {
          await snx.transfer(dao.address, oneToken, { from: defaultAccount })
          await dao.createProposal(stranger, oneToken, description, url, { from: communityMember1 })
          await time.increase(after2Days)
          await dao.voteProposal(1, true, { from: communityMember2 })
          await dao.voteProposal(1, true, { from: communityMember3 })
          await dao.addCommunityMember(stranger, { from: teamMember1 })
        })

        it('does not execute the proposal when the new member votes', async () => {
          await dao.voteProposal(1, true, { from: stranger })
          const proposal = await dao.proposals.call(1)
          assert.isFalse(proposal.teamApproval)
          assert.equal(proposal.receiver, stranger)
        })
      })
    })
  })

  describe('removeCommunityMember', () => {
    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.removeCommunityMember(communityMember1, [], { from: stranger }),
          'Not team member',
        )
      })
    })

    context('when called by a team member', () => {
      it('removes the community member', async () => {
        await dao.removeCommunityMember(communityMember1, [], { from: teamMember1 })
        assert.isFalse(await dao.communityMembers.call(communityMember1))
      })

      it('removes the member form communityAddresses', async () => {
        const expected = [communityMember3, communityMember2]
        await dao.removeCommunityMember(communityMember1, [], { from: teamMember1 })
        assert.deepEqual(expected, await dao.getCommunityMembers.call())
      })

      context('when the community member is the last member', () => {
        beforeEach(async () => {
          await dao.removeCommunityMember(communityMember1, [], { from: teamMember1 })
          await dao.removeCommunityMember(communityMember2, [], { from: teamMember1 })
        })

        it('allows the last community member to be removed', async () => {
          const expected = []
          await dao.removeCommunityMember(communityMember3, [], { from: teamMember1 })
          assert.deepEqual(expected, await dao.getCommunityMembers.call())
        })
      })

      context('when the member has voted on proposals', () => {
        beforeEach(async () => {
          await snx.transfer(dao.address, oneToken, { from: defaultAccount })
          await dao.createProposal(stranger, oneToken, description, url, { from: communityMember1 })
          await time.increase(after2Days)
          await dao.voteProposal(1, true, { from: communityMember2 })
          const proposal = await dao.proposals.call(1)
          assert.isTrue(new BN(2).eq(proposal.approvals))
        })

        it('removes them if they created the proposal', async () => {
          await dao.removeCommunityMember(communityMember1, [1], { from: teamMember1 })
          const proposal = await dao.proposals.call(1)
          assert.isTrue(new BN(1).eq(proposal.approvals))
          assert.isFalse(await dao.voted.call(communityMember1, 1))
        })

        it('removes them if they voted on the proposal', async () => {
          await dao.removeCommunityMember(communityMember2, [1], { from: teamMember1 })
          const proposal = await dao.proposals.call(1)
          assert.isTrue(new BN(1).eq(proposal.approvals))
          assert.isFalse(await dao.voted.call(communityMember2, 1))
        })
      })

      context('when the member has not voted on specified proposals', () => {
        it('reverts', async () => {
          await expectRevert(
            dao.removeCommunityMember(communityMember1, [1], { from: teamMember1 }),
            'Member did not vote for proposal',
          )
        })
      })
    })
  })

  describe('addTeamMember', () => {
    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.addTeamMember(stranger, { from: stranger }),
          'Not team member',
        )
      })
    })

    context('when called by a team member', () => {
      it('adds the team member', async () => {
        await dao.addTeamMember(stranger, { from: teamMember1 })
        assert.isTrue(await dao.teamMembers.call(stranger))
      })

      it('adds the team member to teamAddresses', async () => {
        await dao.addTeamMember(stranger, { from: teamMember1 })
        const expected = [teamMember1, teamMember2, stranger]
        assert.deepEqual(expected, await dao.getTeamMembers.call())
      })
    })
  })

  describe('removeTeamMember', () => {
    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.removeTeamMember(teamMember1, { from: stranger }),
          'Not team member',
        )
      })
    })

    context('when called by a team member', () => {
      it('removes the team member', async () => {
        await dao.removeTeamMember(teamMember2, { from: teamMember1 })
        assert.isFalse(await dao.teamMembers.call(teamMember2))
      })

      it('does not allow the team member to remove self', async () => {
        await expectRevert(
          dao.removeTeamMember(teamMember1, { from: teamMember1 }),
          'Cannot remove self',
        )
      })

      it('removes the team member from teamAddresses', async () => {
        const expected = [teamMember1]
        await dao.removeTeamMember(teamMember2, { from: teamMember1 })
        assert.deepEqual(expected, await dao.getTeamMembers.call())
      })
    })
  })

  describe('updateToPass', () => {
    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.updateToPass(1, { from: stranger }),
          'Not team member',
        )
      })
    })

    context('when called by a team member', () => {
      it('sets the new value', async () => {
        await dao.updateToPass(1, { from: teamMember1 })
        assert.isTrue(new BN(1).eq(await dao.toPass.call()))
      })

      it('does not allow the value to be 0', async () => {
        await expectRevert(
          dao.updateToPass(0, { from: teamMember1 }),
          'Invalid value to pass proposals',
        )
      })
    })
  })

  describe('updateProxyAddress', () => {
    context('when called by a stranger', () => {
      it('reverts', async () => {
        await expectRevert(
          dao.updateProxyAddress(teamMember1, { from: stranger }),
          "Not team member"
        )
      })
    })

    context('when called by a team member', () => {
      it('allows the proxy to be set', async () => {
        await dao.updateProxyAddress(teamMember1, { from: teamMember1 })
        assert.equal(await dao.SNX.call(), teamMember1)
      })

      it('reverts if the same proxy address is used', async () => {
        await expectRevert(
          dao.updateProxyAddress(snx.address, { from: teamMember1 }),
          "Cannot set proxy address to the current proxy address"
        )
      })
    })
  })
})
